import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { config } from "../../config";
import { db } from "../../database/connection";
import { requireUser } from "../auth/auth.service";
import { eventBus } from "../../services/event-bus";
import { asyncHandler, AppError, assertFound } from "../../utils/errors";
import {
  addBackupLog,
  failBackupIfStillActive,
  failBackupsWithCompletedCommands,
  getBackupRow,
  updateBackupProgress,
} from "../backups/backup.service";
import {
  assembleFileChunks,
  cloneBackupFile,
  completeDeletedFileRestore,
  getBackupFilePath,
  getDeletedFileBackupPath,
  queryMissingChunks,
  reportDeletedPaths,
  storeFileChunk,
  writeBackupFile,
} from "../backups/backup-storage.service";
import { createNotification } from "../../services/notification.service";
import { getDevice, getDeviceRow, upsertDisks } from "../devices/device.service";
import { getSettings } from "../settings/settings.service";
import { resolveNotification } from "../../services/notification.service";
import { getPublishedAgent, getPublishedAgentIfAvailable } from "./agent-update.service";
import type { DiskInput } from "../../types/domain";

const diskSchema = z.object({
  id: z.string().trim().min(1).max(255),
  name: z.string().trim().min(1).max(255),
  letter: z.string().max(16).nullable().optional(),
  fileSystem: z.string().max(64).nullable().optional(),
  totalBytes: z.number().int().nonnegative().safe(),
  freeBytes: z.number().int().nonnegative().safe(),
}).strict();
const registrationSchema = z.object({
  agentToken: z.string().trim().min(16).max(512).nullable().optional(),
  computerName: z.string().trim().min(1).max(255),
  windowsUsername: z.string().trim().min(1).max(255),
  ipAddress: z.string().trim().max(255).nullable().optional(),
  macAddress: z.string().trim().regex(/^([0-9a-f]{2}[:-]){5}([0-9a-f]{2})$/i).nullable().optional(),
  operatingSystem: z.string().trim().min(1).max(255),
  agentVersion: z.string().trim().max(64),
  agentBuildHash: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  disks: z.array(diskSchema).max(64),
}).strict();
const heartbeatSchema = z.object({
  status: z.enum(["online", "busy", "error"]),
  agentVersion: z.string().max(64).optional(),
  agentBuildHash: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  ipAddress: z.string().max(255).nullable().optional(),
  disks: z.array(diskSchema).max(64).optional(),
  errorMessage: z.string().max(2000).nullable().optional(),
}).strict();
const progressSchema = z.object({
  status: z.enum(["running", "completed", "failed", "cancelled"]),
  progressPercent: z.number().min(0).max(100),
  bytesProcessed: z.number().int().nonnegative().safe().optional(),
  totalBytes: z.number().int().nonnegative().safe().nullable().optional(),
  backupSizeBytes: z.number().int().nonnegative().safe().nullable().optional(),
  errorMessage: z.string().max(2000).nullable().optional(),
  startedAt: z.string().datetime({ offset: true }).nullable().optional(),
  completedAt: z.string().datetime({ offset: true }).nullable().optional(),
  retentionCount: z.number().int().min(1).max(1000).nullable().optional(),
  inventoryComplete: z.boolean().optional(),
  inventoryMode: z.enum(["full", "delta"]).optional(),
}).strict();
const backupFileQuerySchema = z.object({
  drive: z.string().regex(/^[a-z]$/i),
  path: z.string().trim().min(1).max(4096),
  slot: z.enum(["primary", "secondary"]).default("primary"),
  sizeBytes: z.coerce.number().int().nonnegative().safe(),
  lastWriteTicks: z.string().regex(/^\d{1,19}$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
}).strict();
const cloneFileSchema = backupFileQuerySchema;
const backupLogSchema = z.object({
  level: z.enum(["info", "warning", "error"]),
  message: z.string().trim().min(1).max(2000),
}).strict();

export const agentRouter = Router();
export const legacyAgentInstallerRouter = Router();

function sendAgentInstaller(request: Request, response: Response): void {
  if (!config.agentBootstrapToken) {
    throw new AppError(503, "Agent enrollment is disabled. Configure AGENT_BOOTSTRAP_TOKEN on the server first.");
  }

  const settings = getSettings();
  const advertisedAddress = settings.network.advertisedAddress?.trim();
  let apiBaseUrl: URL;
  if (advertisedAddress) {
    apiBaseUrl = new URL(advertisedAddress);
    if (apiBaseUrl.protocol !== "http:" && apiBaseUrl.protocol !== "https:") {
      throw new AppError(500, "The advertised server address must use HTTP or HTTPS.");
    }
    apiBaseUrl.pathname = `${apiBaseUrl.pathname.replace(/\/+$/, "")}/api/v1/`;
  } else {
    const hostname = request.hostname.includes(":") && !request.hostname.startsWith("[")
      ? `[${request.hostname}]`
      : request.hostname;
    apiBaseUrl = new URL(`${request.protocol}://${hostname}:${settings.server.port}/api/v1/`);
  }

  const executableUrl = new URL("agents/installer/agent.exe", apiBaseUrl).toString();
  const powershell = [
    "$ErrorActionPreference = 'Stop'",
    "$exitCode = 0",
    "$transcriptStarted = $false",
    "$logDirectory = Join-Path $env:ProgramData 'LanVault'",
    "$logPath = Join-Path $logDirectory 'agent-installer.log'",
    "try {",
    "  New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null",
    "  Start-Transcript -Path $logPath -Append | Out-Null",
    "  $transcriptStarted = $true",
    "  Write-Host 'LanVault Agent installer' -ForegroundColor Cyan",
    "  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())",
    "  Write-Host '[1/5] Checking administrator permissions...' -ForegroundColor Cyan",
    "  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Administrator privileges are required. Right-click the installer and choose Run as administrator.' }",
    `  $serverUrl = '${apiBaseUrl.toString().replace(/'/g, "''")}'`,
    `  $bootstrapToken = '${config.agentBootstrapToken.replace(/'/g, "''")}'`,
    `  $installerUrl = '${executableUrl.replace(/'/g, "''")}'`,
    "  $serverOrigin = ([Uri]$serverUrl).GetLeftPart([UriPartial]::Authority)",
    "  if ($serverUrl.StartsWith('https://', [StringComparison]::OrdinalIgnoreCase)) { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 }",
    "  Write-Host '[2/5] Preparing the installation folder...' -ForegroundColor Cyan",
    "  $installDirectory = Join-Path $env:ProgramFiles 'LanVault\\Agent'",
    "  New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null",
    "  $executable = Join-Path $installDirectory 'LanVault.Agent.exe'",
    "  $download = Join-Path $installDirectory ('LanVault.Agent.' + [Guid]::NewGuid().ToString('N') + '.download')",
    "  Write-Host ('[3/5] Downloading the LanVault Agent from ' + $serverOrigin + '...') -ForegroundColor Yellow",
    "  Write-Host 'The agent package is large; download progress will appear below.' -ForegroundColor DarkGray",
    "  $ProgressPreference = 'Continue'",
    "  Invoke-WebRequest -UseBasicParsing -TimeoutSec 600 -Uri $installerUrl -OutFile $download",
    "  if (-not (Test-Path -LiteralPath $download) -or (Get-Item -LiteralPath $download).Length -lt 1048576) { throw 'The downloaded agent package is missing or incomplete. Check the server agent publish step and try again.' }",
    "  Write-Host 'Download verified.' -ForegroundColor Green",
    "  $service = Get-Service -Name 'LanVaultAgent' -ErrorAction SilentlyContinue",
    "  if ($service) {",
    "    if ($service.Status -ne 'Stopped') { Stop-Service -Name 'LanVaultAgent' -Force; (Get-Service -Name 'LanVaultAgent').WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Stopped, [TimeSpan]::FromSeconds(30)) }",
    "    & sc.exe delete LanVaultAgent | Out-Null",
    "    if ($LASTEXITCODE -ne 0) { throw ('Could not remove the existing LanVault Agent service (sc.exe exit code ' + $LASTEXITCODE + ').') }",
    "    $deadline = (Get-Date).AddSeconds(30)",
    "    while ((Get-Service -Name 'LanVaultAgent' -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }",
    "    if (Get-Service -Name 'LanVaultAgent' -ErrorAction SilentlyContinue) { throw 'The previous LanVault Agent service is still being removed. Wait a few seconds and run the installer again.' }",
    "  }",
    "  Write-Host '[4/5] Installing and starting the Windows service...' -ForegroundColor Cyan",
    "  Move-Item -LiteralPath $download -Destination $executable -Force",
    "  New-Service -Name 'LanVaultAgent' -DisplayName 'LanVault Agent' -Description 'LanVault managed backup agent' -BinaryPathName ('\"' + $executable + '\"') -StartupType Automatic | Out-Null",
    "  $serviceKey = 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\LanVaultAgent'",
    "  $serviceEnvironment = New-Object 'System.String[]' 2",
    "  $serviceEnvironment[0] = 'LANVAULT_AGENT_SERVER_URL=' + $serverUrl",
    "  $serviceEnvironment[1] = 'LANVAULT_AGENT_BOOTSTRAP_TOKEN=' + $bootstrapToken",
    "  New-ItemProperty -Path $serviceKey -Name Environment -PropertyType MultiString -Value $serviceEnvironment -Force | Out-Null",
    "  $storedEnvironment = @((Get-ItemProperty -Path $serviceKey -Name Environment).Environment)",
    "  $storedServerUrl = @($storedEnvironment | Where-Object { $_ -like 'LANVAULT_AGENT_SERVER_URL=*' })",
    "  $storedBootstrapToken = @($storedEnvironment | Where-Object { $_ -like 'LANVAULT_AGENT_BOOTSTRAP_TOKEN=*' })",
    "  if ($storedEnvironment.Count -ne 2 -or $storedServerUrl.Count -ne 1 -or $storedBootstrapToken.Count -ne 1 -or $storedServerUrl[0] -cne ('LANVAULT_AGENT_SERVER_URL=' + $serverUrl) -or $storedBootstrapToken[0] -cne ('LANVAULT_AGENT_BOOTSTRAP_TOKEN=' + $bootstrapToken)) { throw 'Windows did not store the Agent service configuration as two separate settings. Remove the LanVault Agent service and run this installer again.' }",
    "  Write-Host 'Service configuration verified (server URL and enrollment token are separate).' -ForegroundColor Green",
    "  $statusPath = Join-Path $env:ProgramData 'LanVault\\Agent\\installer-status.json'",
    "  if (Test-Path -LiteralPath $statusPath) { Remove-Item -LiteralPath $statusPath -Force }",
    "  Start-Service -Name 'LanVaultAgent'",
    "  (Get-Service -Name 'LanVaultAgent').WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Running, [TimeSpan]::FromSeconds(30))",
    "  Write-Host '[5/5] Waiting for the Agent to register with the server...' -ForegroundColor Yellow",
    "  $registrationDeadline = (Get-Date).AddSeconds(120)",
    "  $lastAgentError = $null",
    "  $registeredDeviceId = $null",
    "  while ((Get-Date) -lt $registrationDeadline) {",
    "    if (Test-Path -LiteralPath $statusPath) {",
    "      try {",
    "        $agentStatus = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json",
    "        if ($agentStatus.status -eq 'connected') { $registeredDeviceId = $agentStatus.deviceId; break }",
    "        if ($agentStatus.status -eq 'error' -and $agentStatus.message) { $lastAgentError = $agentStatus.message }",
    "      } catch { }",
    "    }",
    "    Start-Sleep -Seconds 2",
    "  }",
    "  if (-not $registeredDeviceId) {",
    "    if ($lastAgentError) { throw ('Agent service is running but server registration failed: ' + $lastAgentError) }",
    "    throw 'Agent service is running but did not confirm registration within 120 seconds. Check the network and installer log.'",
    "  }",
    "  Write-Host ('SUCCESS: Agent registered with the server (device ID: ' + $registeredDeviceId + '). The device is pending administrator approval.') -ForegroundColor Green",
    "  Write-Host ('Installer log: ' + $logPath)",
    "} catch {",
    "  $exitCode = 1",
    "  Write-Host ''",
    "  $failureMessage = $_.Exception.Message",
    "  if ($_.Exception.Response) {",
    "    try { $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream()); $body = $reader.ReadToEnd(); $reader.Dispose(); if ($body) { $failureMessage = $body } } catch { }",
    "  }",
    "  Write-Host ('Installation failed: ' + $failureMessage) -ForegroundColor Red",
    "  Write-Host ('Installer log: ' + $logPath) -ForegroundColor Yellow",
    "} finally {",
    "  if ($transcriptStarted) { Stop-Transcript | Out-Null }",
    "  Write-Host ''",
    "  if ($exitCode -eq 0) { Read-Host 'Press Enter to close this window' | Out-Null } else { Read-Host 'Copy the error above or send the installer log to your administrator, then press Enter' | Out-Null }",
    "}",
    "exit $exitCode",
  ].join("\r\n");
  const encoded = Buffer.from(powershell, "utf16le").toString("base64");
  response.type("text/plain; charset=utf-8");
  response.attachment("LanVault-Agent-Installer.bat");
  response.send(`@echo off\r\nsetlocal\r\ntitle LanVault Agent Installer\r\npowershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}\r\nexit /b %ERRORLEVEL%\r\n`);
}

agentRouter.get("/installer", requireUser, asyncHandler(sendAgentInstaller));
legacyAgentInstallerRouter.get("/install-script", requireUser, asyncHandler(sendAgentInstaller));

agentRouter.get("/installer/agent.exe", asyncHandler((_request, response) => {
  const executable = path.resolve(process.cwd(), ".runtime/agent/LanVault.Agent.exe");
  if (!existsSync(executable)) {
    throw new AppError(503, "The Windows agent package has not been built. Run the backend publish-agent script.");
  }
  response.download(executable, "LanVault.Agent.exe");
}));

function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

function authenticateAgent(deviceId: string, header: string | undefined) {
  const token = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const stored = getDeviceRow(deviceId)?.agent_token_hash;
  if (!stored || !token) throw new AppError(401, "Valid agent bearer token required");
  const suppliedHash = hashToken(token);
  const storedHash = Buffer.from(stored, "hex");
  if (storedHash.length !== suppliedHash.length || !timingSafeEqual(storedHash, suppliedHash)) {
    throw new AppError(401, "Valid agent bearer token required");
  }
}

agentRouter.post("/register", asyncHandler((request, response) => {
  const input = registrationSchema.parse(request.body);
  if (!config.agentBootstrapToken || input.agentToken !== config.agentBootstrapToken) {
    throw new AppError(403, "Agent enrollment is disabled or the bootstrap token is invalid");
  }
  const now = new Date().toISOString();
  const agentToken = randomBytes(32).toString("base64url");
  const mac = input.macAddress ?? null;
  let existing = mac ? db.prepare("SELECT id FROM devices WHERE mac_address = ? COLLATE NOCASE").get(mac) as { id: string } | undefined : undefined;
  if (!existing) {
    const byName = db.prepare("SELECT id FROM devices WHERE computer_name = ? COLLATE NOCASE").get(input.computerName) as { id: string } | undefined;
    existing = byName;
  }
  const id = existing?.id ?? randomUUID();
  db.transaction(() => {
    if (existing) {
      db.prepare(`
        UPDATE devices SET computer_name = ?, windows_username = ?, ip_address = ?, mac_address = ?,
          operating_system = ?, agent_version = ?, agent_token_hash = ?, status = 'online',
          agent_status = 'online', last_seen_at = ?, updated_at = ? WHERE id = ?
      `).run(input.computerName, input.windowsUsername, input.ipAddress ?? null, mac, input.operatingSystem, input.agentVersion, hashToken(agentToken).toString("hex"), now, now, id);
    } else {
      db.prepare(`
        INSERT INTO devices (id, computer_name, windows_username, ip_address, mac_address, operating_system,
          approval_status, status, agent_status, agent_version, agent_token_hash, last_seen_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', 'online', 'online', ?, ?, ?, ?, ?)
      `).run(id, input.computerName, input.windowsUsername, input.ipAddress ?? null, mac, input.operatingSystem, input.agentVersion, hashToken(agentToken).toString("hex"), now, now, now);
    }
    upsertDisks(id, input.disks as DiskInput[]);
  })();
  const device = getDevice(id);
  resolveNotification("agent_offline", id);
  eventBus.publish("device.created", device);
  response.status(201).json({ data: { device, agentToken, pollingIntervalSeconds: 30 } });
}));

agentRouter.post("/:deviceId/heartbeat", asyncHandler((request, response) => {
  const deviceId = z.string().uuid().parse(request.params.deviceId);
  authenticateAgent(deviceId, request.header("authorization"));
  const input = heartbeatSchema.parse(request.body);
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE devices SET status = ?, agent_status = ?, agent_version = COALESCE(?, agent_version),
      agent_build_hash = COALESCE(?, agent_build_hash), ip_address = COALESCE(?, ip_address),
      last_seen_at = ?, updated_at = ? WHERE id = ?
  `).run(
    input.status, input.status === "error" ? "error" : "online",
    input.agentVersion ?? null, input.agentBuildHash?.toUpperCase() ?? null,
    input.ipAddress ?? null, now, now, deviceId,
  );
  if (input.agentBuildHash) {
    const published = getPublishedAgentIfAvailable();
    if (published?.buildHash === input.agentBuildHash.toUpperCase()) {
      db.prepare(`
        UPDATE devices SET agent_update_status = 'current', agent_update_error = NULL WHERE id = ?
      `).run(deviceId);
    } else {
      const current = db.prepare("SELECT agent_update_status FROM devices WHERE id = ?")
        .get(deviceId) as { agent_update_status: string | null };
      if (current.agent_update_status === "installing") {
        db.prepare(`
          UPDATE devices SET agent_update_status = 'failed',
            agent_update_error = 'Agent restarted with its previous version; the update was rolled back.'
          WHERE id = ?
        `).run(deviceId);
        db.prepare(`
          UPDATE agent_commands SET status = 'completed', completed_at = ?
          WHERE device_id = ? AND type = 'update_agent' AND status IN ('pending', 'delivered', 'acknowledged')
        `).run(now, deviceId);
      } else if (current.agent_update_status === "current") {
        db.prepare(`
          UPDATE devices SET agent_update_status = NULL, agent_update_error = NULL
          WHERE id = ?
        `).run(deviceId);
      }
    }
    const updateCommands = db.prepare(`
      SELECT id, payload FROM agent_commands
      WHERE device_id = ? AND type = 'update_agent' AND status != 'completed'
    `).all(deviceId) as Array<{ id: string; payload: string }>;
    const complete = db.prepare(`
      UPDATE agent_commands SET status = 'completed', completed_at = ?
      WHERE id = ? AND status != 'completed'
    `);
    for (const command of updateCommands) {
      const payload: unknown = JSON.parse(command.payload);
      if (typeof payload === "object" && payload !== null &&
          "buildHash" in payload && typeof payload.buildHash === "string" &&
          payload.buildHash.toUpperCase() === input.agentBuildHash.toUpperCase()) {
        complete.run(now, command.id);
      }
    }
  }
  if (input.disks) upsertDisks(deviceId, input.disks as DiskInput[]);
  failBackupsWithCompletedCommands(deviceId);
  resolveNotification("agent_offline", deviceId);
  const retryThreshold = new Date(Date.now() - getSettings().agent.heartbeatTimeoutSeconds * 1000).toISOString();
  const commands = db.prepare(`
    SELECT id, type, payload FROM agent_commands
    WHERE device_id = ? AND (
      status = 'pending'
      OR (status = 'delivered' AND delivered_at < ?)
      OR (status = 'acknowledged' AND acknowledged_at < ?)
    )
    ORDER BY created_at LIMIT 20
  `).all(deviceId, retryThreshold, retryThreshold) as Array<{ id: string; type: string; payload: string }>;
  if (commands.length) {
    db.transaction(() => {
      const update = db.prepare("UPDATE agent_commands SET status = 'delivered', delivered_at = ? WHERE id = ? AND status IN ('pending', 'delivered', 'acknowledged')");
      for (const command of commands) update.run(now, command.id);
    })();
  }
  eventBus.publish("device.status", getDevice(deviceId, false));
  response.json({ data: { commands: commands.map((command) => ({ id: command.id, type: command.type, payload: JSON.parse(command.payload) })) } });
}));

agentRouter.post("/:deviceId/update-status", asyncHandler((request, response) => {
  const deviceId = z.string().uuid().parse(request.params.deviceId);
  authenticateAgent(deviceId, request.header("authorization"));
  const { status, errorMessage } = z.object({
    status: z.enum(["downloading", "installing", "failed"]),
    errorMessage: z.string().trim().min(1).max(2000).nullable().optional(),
  }).strict().parse(request.body);
  if (status === "failed" && !errorMessage) throw new AppError(400, "A failure reason is required");
  const result = db.prepare(`
    UPDATE devices SET agent_update_status = ?, agent_update_error = ?, updated_at = ?
    WHERE id = ? AND agent_update_status IN ('queued', 'downloading', 'installing')
  `).run(status, status === "failed" ? errorMessage! : null, new Date().toISOString(), deviceId);
  if (result.changes === 0) throw new AppError(409, "No active Agent update is registered for this device");
  if (status === "failed") {
    db.prepare(`
      UPDATE agent_commands SET status = 'completed', completed_at = ?
      WHERE device_id = ? AND type = 'update_agent' AND status IN ('pending', 'delivered', 'acknowledged')
    `).run(new Date().toISOString(), deviceId);
  }
  eventBus.publish("device.updated", getDevice(deviceId, false));
  response.status(204).send();
}));

agentRouter.get("/:deviceId/updates/:buildHash/agent.exe", asyncHandler((request, response) => {
  const deviceId = z.string().uuid().parse(request.params.deviceId);
  const buildHash = z.string().regex(/^[a-f0-9]{64}$/i).parse(request.params.buildHash).toUpperCase();
  authenticateAgent(deviceId, request.header("authorization"));
  const published = getPublishedAgent();
  if (buildHash !== published.buildHash) throw new AppError(409, "The requested Agent build is no longer current. Refresh the update request.");
  response.type("application/octet-stream");
  response.sendFile(published.executablePath);
}));

agentRouter.post("/:deviceId/commands/:commandId/ack", asyncHandler((request, response) => {
  const deviceId = z.string().uuid().parse(request.params.deviceId);
  const commandId = z.string().uuid().parse(request.params.commandId);
  authenticateAgent(deviceId, request.header("authorization"));
  const command = assertFound(db.prepare("SELECT id FROM agent_commands WHERE id = ? AND device_id = ?").get(commandId, deviceId) as { id: string } | undefined, "Command not found");
  db.prepare("UPDATE agent_commands SET status = 'acknowledged', acknowledged_at = ? WHERE id = ? AND status IN ('pending', 'delivered')")
    .run(new Date().toISOString(), command.id);
  response.status(204).send();
}));

agentRouter.post("/:deviceId/backups/:backupId/progress", asyncHandler((request, response) => {
  const deviceId = z.string().uuid().parse(request.params.deviceId);
  const backupId = z.string().uuid().parse(request.params.backupId);
  authenticateAgent(deviceId, request.header("authorization"));
  const result = updateBackupProgress(deviceId, backupId, progressSchema.parse(request.body));
  response.json({ data: result });
}));

agentRouter.post("/:deviceId/backups/:backupId/logs", asyncHandler((request, response) => {
  const deviceId = z.string().uuid().parse(request.params.deviceId);
  const backupId = z.string().uuid().parse(request.params.backupId);
  authenticateAgent(deviceId, request.header("authorization"));
  const backup = getBackupRow(backupId);
  if (!backup || backup.device_id !== deviceId) throw new AppError(404, "Backup not found");
  const { level, message } = backupLogSchema.parse(request.body);
  addBackupLog(backupId, level, message);
  response.status(204).send();
}));

agentRouter.post("/:deviceId/backups/:backupId/files", asyncHandler(async (request, response) => {
  const deviceId = z.string().uuid().parse(request.params.deviceId);
  const backupId = z.string().uuid().parse(request.params.backupId);
  authenticateAgent(deviceId, request.header("authorization"));
  if (!request.is("application/octet-stream")) throw new AppError(415, "Backup file uploads must use application/octet-stream");
  const { drive, path: relativePath, slot, sizeBytes, lastWriteTicks, sha256 } = backupFileQuerySchema.parse(request.query);
  await writeBackupFile(deviceId, backupId, drive, relativePath, slot, { sizeBytes, lastWriteTicks, sha256 }, request);
  addBackupLog(backupId, "info", `Uploaded ${drive.toUpperCase()}:\\${relativePath} (${sizeBytes} bytes, ${slot} destination)`);
  response.status(201).json({ data: { uploaded: true } });
}));

agentRouter.post("/:deviceId/backups/:backupId/files/clone", asyncHandler(async (request, response) => {
  const deviceId = z.string().uuid().parse(request.params.deviceId);
  const backupId = z.string().uuid().parse(request.params.backupId);
  authenticateAgent(deviceId, request.header("authorization"));
  const { drive, path: relativePath, slot, sizeBytes, lastWriteTicks, sha256 } = cloneFileSchema.parse(request.body);
  const cloned = await cloneBackupFile(deviceId, backupId, drive, relativePath, slot, { sizeBytes, lastWriteTicks, sha256 });
  if (cloned) addBackupLog(backupId, "info", `Reused unchanged file ${drive.toUpperCase()}:\\${relativePath} (${sizeBytes} bytes, ${slot} destination)`);
  response.json({ data: { cloned } });
}));

const chunkQuerySchema = z.object({
  drive: z.string().regex(/^[a-z]$/i),
  path: z.string().trim().min(1).max(4096),
  slot: z.enum(["primary", "secondary"]).default("primary"),
  sizeBytes: z.coerce.number().int().nonnegative().safe(),
  chunkSize: z.coerce.number().int().min(256 * 1024).max(8 * 1024 * 1024),
  chunks: z.array(z.string().regex(/^[a-f0-9]{64}$/i)).min(1).max(20000),
}).strict();

agentRouter.post("/:deviceId/backups/:backupId/files/chunks/query", asyncHandler(async (request, response) => {
  const deviceId = z.string().uuid().parse(request.params.deviceId);
  const backupId = z.string().uuid().parse(request.params.backupId);
  authenticateAgent(deviceId, request.header("authorization"));
  const { drive, path: relativePath, slot, sizeBytes, chunkSize, chunks } = chunkQuerySchema.parse(request.body);
  const missing = await queryMissingChunks(deviceId, backupId, drive, relativePath, slot, { sizeBytes, chunkSize, chunks });
  response.json({ data: { missing } });
}));

const chunkUploadSchema = z.object({
  drive: z.string().regex(/^[a-z]$/i),
  path: z.string().trim().min(1).max(4096),
  slot: z.enum(["primary", "secondary"]).default("primary"),
  chunkIndex: z.coerce.number().int().nonnegative().max(20000),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
}).strict();

agentRouter.post("/:deviceId/backups/:backupId/files/chunks", asyncHandler(async (request, response) => {
  const deviceId = z.string().uuid().parse(request.params.deviceId);
  const backupId = z.string().uuid().parse(request.params.backupId);
  authenticateAgent(deviceId, request.header("authorization"));
  if (!request.is("application/octet-stream")) throw new AppError(415, "Chunk uploads must use application/octet-stream");
  const { drive, path: relativePath, slot, chunkIndex, sha256 } = chunkUploadSchema.parse(request.query);
  await storeFileChunk(deviceId, backupId, drive, relativePath, slot, chunkIndex, sha256, request);
  response.status(201).json({ data: { stored: true } });
}));

const chunkAssembleSchema = z.object({
  drive: z.string().regex(/^[a-z]$/i),
  path: z.string().trim().min(1).max(4096),
  slot: z.enum(["primary", "secondary"]).default("primary"),
  sizeBytes: z.coerce.number().int().nonnegative().safe(),
  lastWriteTicks: z.string().regex(/^\d{1,19}$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  chunkSize: z.coerce.number().int().min(256 * 1024).max(8 * 1024 * 1024),
  chunkShas: z.array(z.string().regex(/^[a-f0-9]{64}$/i)).min(1).max(20000),
}).strict();

agentRouter.post("/:deviceId/backups/:backupId/files/chunks/assemble", asyncHandler(async (request, response) => {
  const deviceId = z.string().uuid().parse(request.params.deviceId);
  const backupId = z.string().uuid().parse(request.params.backupId);
  authenticateAgent(deviceId, request.header("authorization"));
  const { drive, path: relativePath, slot, sizeBytes, lastWriteTicks, sha256, chunkSize, chunkShas } = chunkAssembleSchema.parse(request.body);
  await assembleFileChunks(deviceId, backupId, drive, relativePath, slot,
    { sizeBytes, lastWriteTicks, sha256 }, chunkSize, chunkShas);
  addBackupLog(backupId, "info", `Uploaded changed blocks of ${drive.toUpperCase()}:\\${relativePath} (${sizeBytes} bytes, ${slot} destination)`);
  response.status(201).json({ data: { assembled: true } });
}));

const deletedPathsSchema = z.object({
  paths: z.array(z.object({
    drive: z.string().regex(/^[a-z]$/i),
    relativePath: z.string().trim().min(1).max(4096),
  }).strict()).min(1).max(5000),
}).strict();

agentRouter.post("/:deviceId/backups/:backupId/deleted-paths", asyncHandler(async (request, response) => {
  const deviceId = z.string().uuid().parse(request.params.deviceId);
  const backupId = z.string().uuid().parse(request.params.backupId);
  authenticateAgent(deviceId, request.header("authorization"));
  const backup = getBackupRow(backupId);
  if (!backup || backup.device_id !== deviceId) throw new AppError(404, "Backup not found");
  const { paths } = deletedPathsSchema.parse(request.body);
  const deletedCount = reportDeletedPaths(deviceId, backupId, paths);
  if (deletedCount > 0) {
    const device = getDeviceRow(deviceId);
    createNotification({
      type: "files_deleted",
      sourceKey: backupId,
      deviceId,
      title: `Files deleted from ${device?.computer_name ?? deviceId}`,
      message: `${deletedCount} file(s) disappeared from the backup inventory. Review Restore files to recover them.`,
      severity: "warning",
    });
  }
  response.status(202).json({ data: { deleted: deletedCount } });
}));

agentRouter.get("/:deviceId/restores/:deletedFileId/file", asyncHandler(async (request, response) => {
  const deviceId = z.string().uuid().parse(request.params.deviceId);
  const deletedFileId = z.string().uuid().parse(request.params.deletedFileId);
  authenticateAgent(deviceId, request.header("authorization"));
  const { path: filePath, release } = await getDeletedFileBackupPath(deviceId, deletedFileId);
  response.type("application/octet-stream");
  response.download(filePath, (error?: unknown) => {
    try {
      release();
    } catch {
      // Temporary cleanup is best effort.
    }
    if (error && !response.headersSent) response.status(500).end();
  });
}));

agentRouter.get("/:deviceId/backup-files/:backupId/file", asyncHandler(async (request, response) => {
  const deviceId = z.string().uuid().parse(request.params.deviceId);
  const backupId = z.string().uuid().parse(request.params.backupId);
  authenticateAgent(deviceId, request.header("authorization"));
  const { drive, path: relativePath } = z.object({
    drive: z.string().regex(/^[a-z]$/i),
    path: z.string().trim().min(1).max(4096),
  }).strict().parse(request.query);
  const { path: filePath, release } = await getBackupFilePath(deviceId, backupId, drive, relativePath);
  response.type("application/octet-stream");
  response.download(filePath, (error?: unknown) => {
    try {
      release();
    } catch {
      // Temporary cleanup is best effort.
    }
    if (error && !response.headersSent) response.status(500).end();
  });
}));

agentRouter.post("/:deviceId/file-restores/result", asyncHandler((request, response) => {  const deviceId = z.string().uuid().parse(request.params.deviceId);
  authenticateAgent(deviceId, request.header("authorization"));
  const { backupId, drive, relativePath, errorMessage } = z.object({
    backupId: z.string().uuid(),
    drive: z.string().regex(/^[a-z]$/i),
    relativePath: z.string().trim().min(1).max(4096),
    errorMessage: z.string().trim().min(1).max(2000).nullable().optional(),
  }).strict().parse(request.body);
  const backup = getBackupRow(backupId);
  if (!backup || backup.device_id !== deviceId) throw new AppError(404, "Backup not found");
  const status = errorMessage ? "error" : "info";
  const message = errorMessage
    ? `Restore failed for ${drive.toUpperCase()}:\\${relativePath}: ${errorMessage}`
    : `Restored ${drive.toUpperCase()}:\\${relativePath} from backup ${backupId}`;
  addBackupLog(backupId, status, message);
  response.status(204).send();
}));

agentRouter.post("/:deviceId/restores/:deletedFileId/result", asyncHandler((request, response) => {
  const deviceId = z.string().uuid().parse(request.params.deviceId);
  const deletedFileId = z.string().uuid().parse(request.params.deletedFileId);
  authenticateAgent(deviceId, request.header("authorization"));
  const { errorMessage } = z.object({
    errorMessage: z.string().trim().min(1).max(2000).nullable().optional(),
  }).strict().parse(request.body);
  completeDeletedFileRestore(deviceId, deletedFileId, errorMessage ?? undefined);
  response.status(204).send();
}));

agentRouter.post("/:deviceId/commands/:commandId/complete", asyncHandler((request, response) => {
  const deviceId = z.string().uuid().parse(request.params.deviceId);
  const commandId = z.string().uuid().parse(request.params.commandId);
  authenticateAgent(deviceId, request.header("authorization"));
  const command = assertFound(db.prepare("SELECT id, type, payload, backup_id FROM agent_commands WHERE id = ? AND device_id = ?")
    .get(commandId, deviceId) as { id: string; type: string; payload: string; backup_id: string | null } | undefined, "Command not found");
  if (command.type === "backup" && command.backup_id) {
    failBackupIfStillActive(deviceId, command.backup_id);
  }
  if (command.type === "restore_file") {
    const payload: unknown = JSON.parse(command.payload);
    if (typeof payload !== "object" || payload === null) {
      throw new AppError(500, "Restore command payload is invalid");
    }
    if ("deletedFileId" in payload && typeof payload.deletedFileId === "string") {
      const file = db.prepare("SELECT restore_status FROM deleted_files WHERE id = ? AND device_id = ?")
        .get(payload.deletedFileId, deviceId) as { restore_status: string } | undefined;
      if (file?.restore_status === "queued") {
        throw new AppError(409, "Restore command cannot complete before the Agent reports its result");
      }
    } else if (!("backupId" in payload) || typeof payload.backupId !== "string") {
      throw new AppError(500, "Restore command payload is invalid");
    }
  }
  db.prepare("UPDATE agent_commands SET status = 'completed', completed_at = ? WHERE id = ?")
    .run(new Date().toISOString(), command.id);
  response.status(204).send();
}));

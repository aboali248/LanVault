import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db } from "../../database/connection";
import { getDevice, getDeviceRow, getGroupBackupConfig, toDiskApi } from "../devices/device.service";
import { getConfiguredBackupDestination, getSettings } from "../settings/settings.service";
import type { BackupMode, BackupRow, BackupStatus, DeviceRow, DiskRow } from "../../types/domain";
import { AppError, assertFound } from "../../utils/errors";
import { parseJson } from "../../utils/json";
import { eventBus } from "../../services/event-bus";
import { createNotification } from "../../services/notification.service";
import { deleteEmptyBackupRun, maintainBackupStorage, prepareBackupDirectories, recordDeletedFiles } from "./backup-storage.service";
import { enqueueBackupReplication } from "./replication.service";
import { legacyMachineDirectory, resolveMachineDirectory } from "./backup-paths";
import { resolveExcludedExtensions } from "./file-exclusions";

interface BackupWithDeviceRow extends BackupRow {
  computer_name: string;
  group_id: string | null;
  group_name: string | null;
}

export interface BackupApi {
  id: string;
  deviceId: string;
  device: { id: string; computerName: string; group: { id: string; name: string } | null };
  mode: BackupMode;
  status: BackupStatus;
  progressPercent: number;
  bytesProcessed: number;
  totalBytes: number | null;
  backupSizeBytes: number | null;
  destination: string | null;
  disks: ReturnType<typeof toDiskApi>[];
  requestedBy: string | null;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

const backupSelect = `
  SELECT b.*, d.computer_name, d.group_id, g.name AS group_name
  FROM backups b
  INNER JOIN devices d ON d.id = b.device_id
  LEFT JOIN groups g ON g.id = d.group_id
`;

function toBackupApi(row: BackupWithDeviceRow): BackupApi {
  const disks = parseJson<DiskRow[]>(row.disks_snapshot, []);
  return {
    id: row.id,
    deviceId: row.device_id,
    device: {
      id: row.device_id,
      computerName: row.computer_name,
      group: row.group_id && row.group_name ? { id: row.group_id, name: row.group_name } : null,
    },
    mode: row.mode,
    status: row.status,
    progressPercent: row.progress_percent,
    bytesProcessed: row.bytes_processed,
    totalBytes: row.total_bytes,
    backupSizeBytes: row.backup_size_bytes,
    destination: row.destination,
    disks: disks.map(toDiskApi),
    requestedBy: row.requested_by,
    requestedAt: row.requested_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getBackup(id: string): BackupApi {
  const row = assertFound(
    db.prepare(`${backupSelect} WHERE b.id = ?`).get(id) as BackupWithDeviceRow | undefined,
    "Backup not found",
  );
  return toBackupApi(row);
}

export function getBackupRow(id: string): BackupRow | undefined {
  return db.prepare("SELECT * FROM backups WHERE id = ?").get(id) as BackupRow | undefined;
}

const backupCommandMissingResultMessage =
  "The Agent completed the backup command without reporting a final backup result. Check the Agent service logs on the device and retry.";

export function failBackupIfStillActive(deviceId: string, backupId: string): void {
  const backup = getBackupRow(backupId);
  if (!backup || backup.device_id !== deviceId ||
      !["queued", "running", "cancel_requested"].includes(backup.status)) return;

  updateBackupProgress(deviceId, backupId, {
    status: "failed",
    progressPercent: backup.progress_percent,
    bytesProcessed: backup.bytes_processed,
    totalBytes: backup.total_bytes,
    errorMessage: backupCommandMissingResultMessage,
  });
}

export function failBackupsWithCompletedCommands(deviceId: string): void {
  const backups = db.prepare(`
    SELECT b.id
    FROM backups b
    JOIN agent_commands c ON c.backup_id = b.id AND c.device_id = b.device_id
    WHERE b.device_id = ? AND c.type = 'backup' AND c.status = 'completed'
      AND b.status IN ('queued', 'running', 'cancel_requested')
  `).all(deviceId) as Array<{ id: string }>;

  for (const backup of backups) failBackupIfStillActive(deviceId, backup.id);
}

export function createBackupJob(input: {
  deviceId: string;
  mode: BackupMode;
  destination?: string | null;
  requestedBy?: string | null;
  retentionCount?: number | null;
  inventoryComplete?: boolean;
  enableContinuous?: boolean;
  continuousRun?: boolean;
}): BackupApi {
  const device = assertFound(getDeviceRow(input.deviceId), "Device not found");
  if (device.approval_status !== "approved") {
    throw new AppError(409, "Only approved devices can receive backup jobs");
  }
  const disks = db.prepare("SELECT * FROM disks WHERE device_id = ? AND is_selected = 1 ORDER BY COALESCE(letter, ''), name")
    .all(input.deviceId) as DiskRow[];
  if (!disks.length) {
    throw new AppError(422, "Select at least one disk before starting a backup");
  }
  const destination = input.destination?.trim() || getConfiguredBackupDestination();
  if (!destination) {
    throw new AppError(422, "Configure a backup destination before starting a backup");
  }
  const id = randomUUID();
  const commandId = randomUUID();
  const now = new Date().toISOString();
  const snapshot = JSON.stringify(disks);
  const groupConfig = getGroupBackupConfig(device.group_id) ?? {};
  const globalSettings = getSettings().backup;
  const excludedExtensions = resolveExcludedExtensions(
    globalSettings.excludedExtensions,
    parseJson<unknown>(device.backup_excluded_extensions, []),
    parseJson<unknown>(device.backup_included_extensions, []),
  );
  const secondaryDestination = globalSettings.secondaryDestination?.trim() || null;
  if (secondaryDestination && secondaryDestination.toLocaleLowerCase() === destination.toLocaleLowerCase()) {
    throw new AppError(422, "Primary and secondary backup destinations must be different");
  }
  prepareBackupDirectories(device.computer_name, input.deviceId, disks, [destination]);
  if (secondaryDestination) {
    // The secondary copy is replicated by the server in the background, so an
    // unavailable secondary drive must not block queueing the backup itself.
    try {
      prepareBackupDirectories(device.computer_name, input.deviceId, disks, [secondaryDestination]);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown filesystem error";
      console.warn(`Secondary destination is not ready; content will replicate once it is available: ${reason}`);
    }
  }
  const payload = JSON.stringify({
    backupId: id,
    mode: input.mode,
    destination,
    secondaryDestination,
    disks: disks.map((disk) => disk.letter || disk.disk_key),
    excludedExtensions,
    maxTransferRateMbps: Number(groupConfig.maxTransferMbps ?? globalSettings.maxTransferRateMbps ?? 0) || null,
    retentionCount: Number(input.retentionCount ?? groupConfig.retentionCount ?? globalSettings.retentionCount ?? 0) || null,
    requestedAt: now,
  });
  db.transaction(() => {
    const activeBackup = db.prepare(`
      SELECT id FROM backups
      WHERE device_id = ? AND status IN ('queued', 'running', 'cancel_requested')
      LIMIT 1
    `).get(input.deviceId);
    if (activeBackup) {
      throw new AppError(409, "This device already has an active backup");
    }
    db.prepare(`
      INSERT INTO backups (
        id, device_id, mode, status, progress_percent, bytes_processed, destination,
        disks_snapshot, requested_by, requested_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'queued', 0, 0, ?, ?, ?, ?, ?, ?)
    `).run(id, input.deviceId, input.mode, destination, snapshot, input.requestedBy ?? null, now, now, now);
    db.prepare(`
      INSERT INTO agent_commands (id, device_id, backup_id, type, payload, status, created_at)
      VALUES (?, ?, ?, 'backup', ?, 'pending', ?)
    `).run(commandId, input.deviceId, id, payload, now);
    if (input.enableContinuous) {
      db.prepare(`
        UPDATE devices SET continuous_backup_enabled = 1,
          continuous_backup_next_run_at = NULL, updated_at = ?
        WHERE id = ?
      `).run(now, input.deviceId);
    } else if (input.continuousRun) {
      db.prepare("UPDATE devices SET continuous_backup_next_run_at = NULL, updated_at = ? WHERE id = ?")
        .run(now, input.deviceId);
    }
    addBackupLogInternal(id, "info", `${input.mode === "full" ? "Full" : "Incremental"} backup queued`, now);
  })();
  const backup = getBackup(id);
  eventBus.publish("backup.created", backup);
  return backup;
}

export function requestStopBackup(id: string): BackupApi {
  const backup = assertFound(getBackupRow(id), "Backup not found");
  if (["completed", "failed", "cancelled"].includes(backup.status)) {
    throw new AppError(409, "This backup is already in a terminal state");
  }
  const now = new Date().toISOString();
  db.transaction(() => {
    if (backup.status === "queued") {
      db.prepare("UPDATE agent_commands SET status = 'cancelled', completed_at = ? WHERE backup_id = ? AND type = 'backup' AND status = 'pending'")
        .run(now, id);
      db.prepare("UPDATE backups SET status = 'cancelled', completed_at = ?, updated_at = ? WHERE id = ?")
        .run(now, now, id);
      addBackupLogInternal(id, "info", "Queued backup cancelled before delivery", now);
      return;
    }
    db.prepare("UPDATE backups SET status = 'cancel_requested', updated_at = ? WHERE id = ?").run(now, id);
    db.prepare(`
      INSERT INTO agent_commands (id, device_id, backup_id, type, payload, status, created_at)
      VALUES (?, ?, ?, 'stop_backup', ?, 'pending', ?)
    `).run(randomUUID(), backup.device_id, id, JSON.stringify({ backupId: id }), now);
    addBackupLogInternal(id, "warning", "Stop requested by administrator", now);
  })();
  const updated = getBackup(id);
  eventBus.publish("backup.progress", updated);
  return updated;
}

export function updateBackupProgress(
  deviceId: string,
  backupId: string,
  input: {
    status: "running" | "completed" | "failed" | "cancelled";
    progressPercent: number;
    bytesProcessed?: number;
    totalBytes?: number | null;
    backupSizeBytes?: number | null;
    errorMessage?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
    retentionCount?: number | null;
    inventoryComplete?: boolean;
    inventoryMode?: "full" | "delta";
  },
): BackupApi {
  const backup = assertFound(getBackupRow(backupId), "Backup not found");
  if (backup.device_id !== deviceId) throw new AppError(403, "Backup does not belong to this device");
  if (["completed", "failed", "cancelled"].includes(backup.status)) {
    throw new AppError(409, "Cannot update a completed backup");
  }
  const now = new Date().toISOString();
  const isTerminal = input.status !== "running";
  // A pending cancellation remains visible until the agent confirms the terminal result.
  const nextStatus: BackupStatus = input.status === "running" && backup.status === "cancel_requested"
    ? "cancel_requested"
    : input.status;
  db.transaction(() => {
    db.prepare(`
      UPDATE backups SET
        status = ?, progress_percent = ?, bytes_processed = ?, total_bytes = ?, backup_size_bytes = ?,
        error_message = ?, started_at = COALESCE(started_at, ?),
        completed_at = CASE WHEN ? THEN COALESCE(?, ?) ELSE completed_at END,
        updated_at = ?
      WHERE id = ?
    `).run(
      nextStatus,
      isTerminal && input.progressPercent === 0 && backup.progress_percent > 0
        ? backup.progress_percent
        : input.progressPercent,
      input.bytesProcessed ?? backup.bytes_processed,
      input.totalBytes ?? backup.total_bytes,
      input.backupSizeBytes ?? backup.backup_size_bytes,
      input.errorMessage ?? null,
      input.startedAt ?? now,
      isTerminal ? 1 : 0,
      input.completedAt ?? null,
      now,
      now,
      backupId,
    );
    if (input.status === "failed" && input.errorMessage) addBackupLogInternal(backupId, "error", input.errorMessage, now);
    if (isTerminal) {
      db.prepare("UPDATE agent_commands SET status = 'completed', completed_at = ? WHERE backup_id = ? AND status IN ('pending', 'delivered', 'acknowledged')")
        .run(now, backupId);
    }
  })();
  const updated = getBackup(backupId);
  if (input.status === "failed") {
    createNotification({
      type: "backup_failed",
      sourceKey: backupId,
      deviceId,
      title: `Backup failed: ${updated.device.computerName}`,
      message: input.errorMessage ?? "The backup failed without an error message.",
      severity: "error",
    });
  }
  if (input.status === "completed") {
    const device = getDeviceRow(deviceId);
    const groupConfig = getGroupBackupConfig(device?.group_id ?? null) ?? {};
    const globalSettings = getSettings().backup;
    const retentionCount = input.retentionCount ?? (Number(groupConfig.retentionCount ?? globalSettings.retentionCount ?? 0) || null);
    maintainBackupStorage(deviceId, backupId, retentionCount ?? null);
    // Queue server-side replication of this backup's content to the secondary
    // destination (if configured). Queue rows reference the backup, so an
    // empty automatic run that is deleted below takes its entries with it.
    enqueueBackupReplication(backupId);
    if (input.inventoryComplete) {
      if ((input.totalBytes ?? 0) === 0) {
        // Automatic run that protected nothing new: drop the empty row
        // instead of piling up noise. Manual runs are always kept
        // (deleteEmptyBackupRun requires requested_by to be set).
        if (deleteEmptyBackupRun(deviceId, backupId, input.inventoryMode)) {
          // The silent delete removes the scheduler's newest reference point,
          // so pin the next continuous run to the effective interval from now.
          // Otherwise the scheduler would see only the older backup and queue
          // the next run immediately in a tight loop.
          const continuousRow = getDeviceRow(deviceId);
          if (continuousRow?.continuous_backup_enabled) {
            const interval = continuousRow.backup_interval_minutes
              ?? globalSettings.continuousBackupIntervalMinutes ?? 5;
            const nextRunAt = new Date(Date.now() + Math.max(1, interval) * 60_000).toISOString();
            db.prepare("UPDATE devices SET continuous_backup_next_run_at = ?, updated_at = ? WHERE id = ?")
              .run(nextRunAt, now, deviceId);
          }
          eventBus.publish("backup.deleted", { id: backupId, deviceId });
          return updated;
        }
      }
      const deletedCount = recordDeletedFiles(deviceId, backupId, input.inventoryMode);
      if (deletedCount > 0) {
        createNotification({
          type: "files_deleted",
          sourceKey: backupId,
          deviceId,
          title: `Files deleted from ${updated.device.computerName}`,
          message: `${deletedCount} file(s) disappeared from a complete backup inventory. Review Restore files to recover them.`,
          severity: "warning",
        });
      }
    }
  }
  eventBus.publish("backup.progress", updated);
  return updated;
}

export function addBackupLog(backupId: string, level: "info" | "warning" | "error", message: string): void {
  assertFound(getBackupRow(backupId), "Backup not found");
  const createdAt = new Date().toISOString();
  addBackupLogInternal(backupId, level, message, createdAt);
  if (level === "error") eventBus.publish("backup.error", { backupId, message });
}

function addBackupLogInternal(backupId: string, level: "info" | "warning" | "error", message: string, createdAt: string): void {
  db.prepare("INSERT INTO backup_logs (id, backup_id, level, message, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(randomUUID(), backupId, level, message, createdAt);
}

export function getBackupLogs(backupId: string, limit = 50, offset = 0) {
  assertFound(getBackupRow(backupId), "Backup not found");
  const total = (db.prepare("SELECT COUNT(*) AS count FROM backup_logs WHERE backup_id = ?")
    .get(backupId) as { count: number }).count;
  const rows = db.prepare("SELECT id, level, message, created_at FROM backup_logs WHERE backup_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?")
    .all(backupId, limit, offset) as Array<{ id: string; level: string; message: string; created_at: string }>;
  return { items: rows.map((row) => ({
      id: row.id,
      level: row.level,
      message: row.message,
      createdAt: row.created_at,
    })), total };
}

export function listBackupRows(options: {
  deviceId?: string;
  status?: BackupStatus;
  mode?: BackupMode;
  limit: number;
  offset: number;
}): { rows: BackupApi[]; total: number } {
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (options.deviceId) {
    clauses.push("b.device_id = ?");
    values.push(options.deviceId);
  }
  if (options.status) {
    clauses.push("b.status = ?");
    values.push(options.status);
  }
  if (options.mode) {
    clauses.push("b.mode = ?");
    values.push(options.mode);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const total = (db.prepare(`SELECT COUNT(*) AS count FROM backups b ${where}`).get(...values) as { count: number }).count;
  const rows = db.prepare(`${backupSelect} ${where} ORDER BY b.requested_at DESC LIMIT ? OFFSET ?`)
    .all(...values, options.limit, options.offset) as BackupWithDeviceRow[];
  return { rows: rows.map(toBackupApi), total };
}

export function listLatestBackupRows(options: {
  limit: number;
  offset: number;
}): { rows: BackupApi[]; total: number } {
  const total = (db.prepare(`
    SELECT COUNT(DISTINCT device_id) AS count FROM backups
  `).get() as { count: number }).count;
  const rows = db.prepare(`
    WITH ranked AS (
      SELECT b.*,
        ROW_NUMBER() OVER (PARTITION BY b.device_id ORDER BY b.requested_at DESC, b.created_at DESC) AS rn
      FROM backups b
    )
    SELECT ranked.*, d.computer_name, d.group_id, g.name AS group_name
    FROM ranked
    INNER JOIN devices d ON d.id = ranked.device_id
    LEFT JOIN groups g ON g.id = d.group_id
    WHERE ranked.rn = 1
    ORDER BY ranked.requested_at DESC LIMIT ? OFFSET ?
  `).all(options.limit, options.offset) as BackupWithDeviceRow[];
  return { rows: rows.map(toBackupApi), total };
}

export function queueGroupBackups(groupId: string, mode: BackupMode, requestedBy?: string | null, retentionCount?: number | null, enableContinuous = false): { queued: BackupApi[]; skipped: Array<{ deviceId: string; reason: string }> } {
  const group = db.prepare("SELECT id FROM groups WHERE id = ?").get(groupId) as { id: string } | undefined;
  assertFound(group, "Group not found");
  const devices = db.prepare("SELECT * FROM devices WHERE group_id = ? ORDER BY computer_name").all(groupId) as DeviceRow[];
  const queued: BackupApi[] = [];
  const skipped: Array<{ deviceId: string; reason: string }> = [];
  for (const device of devices) {
    try {
      queued.push(createBackupJob({ deviceId: device.id, mode, requestedBy, retentionCount, enableContinuous }));
    } catch (error) {
      skipped.push({ deviceId: device.id, reason: error instanceof Error ? error.message : "Unable to queue backup" });
    }
  }
  if (devices.length === 0) throw new AppError(422, "This group has no devices");
  return { queued, skipped };
}

export function getSelectedDisksForDevice(deviceId: string): DiskRow[] {
  return db.prepare("SELECT * FROM disks WHERE device_id = ? AND is_selected = 1 ORDER BY COALESCE(letter, ''), name")
    .all(deviceId) as DiskRow[];
}

export function getDeviceForBackupSummary(deviceId: string) {
  return getDevice(deviceId);
}

const ACTIVE_BACKUP_STATUSES = ["queued", "running", "cancel_requested"] as const;

function removeBackupSnapshotFolders(rows: Array<{ id: string; device_id: string; destination: string | null }>): void {
  const settings = getSettings().backup;
  for (const row of rows) {
    const device = db.prepare("SELECT computer_name FROM devices WHERE id = ?").get(row.device_id) as { computer_name: string } | undefined;
    if (!device) continue;
    const destinations = [...new Set([
      row.destination?.trim() || getConfiguredBackupDestination(),
      settings.secondaryDestination?.trim() || null,
    ].filter((item): item is string => Boolean(item)))];
    for (const destination of destinations) {
      try {
        const machineDirectory = resolveMachineDirectory(destination, device.computer_name, row.device_id, false)
          ?? legacyMachineDirectory(destination, device.computer_name, row.device_id);
        const snapshot = path.join(machineDirectory, row.id);
        if (fs.existsSync(snapshot)) fs.rmSync(snapshot, { recursive: true, force: true });
      } catch {
        // Snapshot cleanup is best effort; DB rows are already gone.
      }
    }
  }
}

function deleteBackupRows(rows: Array<{ id: string; device_id: string; destination: string | null }>): number {
  if (!rows.length) return 0;
  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => "?").join(",");
  db.transaction(() => {
    db.prepare(`DELETE FROM agent_commands WHERE backup_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM notifications WHERE source_key IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM backups WHERE id IN (${placeholders})`).run(...ids);
  })();
  removeBackupSnapshotFolders(rows);
  for (const row of rows) {
    eventBus.publish("backup.deleted", { id: row.id, deviceId: row.device_id });
  }
  return rows.length;
}

/** Delete one backup and its run logs. Active runs cannot be deleted. */
export function deleteBackup(id: string): { deleted: number } {
  const row = assertFound(
    db.prepare("SELECT id, device_id, destination, status FROM backups WHERE id = ?").get(id) as
      { id: string; device_id: string; destination: string | null; status: BackupStatus } | undefined,
    "Backup not found",
  );
  if ((ACTIVE_BACKUP_STATUSES as readonly string[]).includes(row.status)) {
    throw new AppError(409, "Stop the active backup before deleting it");
  }
  return { deleted: deleteBackupRows([row]) };
}

/** Clear only the run logs of one backup, keeping the backup record itself. */
export function clearBackupLogs(id: string): { deleted: number } {
  assertFound(getBackupRow(id), "Backup not found");
  const result = db.prepare("DELETE FROM backup_logs WHERE backup_id = ?").run(id);
  return { deleted: Number(result.changes) };
}

function deletableBackupRows(deviceId?: string): Array<{ id: string; device_id: string; destination: string | null }> {
  const placeholders = ACTIVE_BACKUP_STATUSES.map(() => "?").join(",");
  if (deviceId) {
    return db.prepare(
      `SELECT id, device_id, destination FROM backups WHERE device_id = ? AND status NOT IN (${placeholders})`,
    ).all(deviceId, ...ACTIVE_BACKUP_STATUSES) as Array<{ id: string; device_id: string; destination: string | null }>;
  }
  return db.prepare(
    `SELECT id, device_id, destination FROM backups WHERE status NOT IN (${placeholders})`,
  ).all(...ACTIVE_BACKUP_STATUSES) as Array<{ id: string; device_id: string; destination: string | null }>;
}

function countActiveBackups(deviceId?: string): number {
  const placeholders = ACTIVE_BACKUP_STATUSES.map(() => "?").join(",");
  const row = deviceId
    ? db.prepare(`SELECT COUNT(*) AS count FROM backups WHERE device_id = ? AND status IN (${placeholders})`).get(deviceId, ...ACTIVE_BACKUP_STATUSES) as { count: number }
    : db.prepare(`SELECT COUNT(*) AS count FROM backups WHERE status IN (${placeholders})`).get(...ACTIVE_BACKUP_STATUSES) as { count: number };
  return row.count;
}

/** Delete all non-active backups of one device (history + run logs). Active runs are skipped. */
export function deleteDeviceBackups(deviceId: string): { deleted: number; skipped: number } {
  assertFound(getDeviceRow(deviceId), "Device not found");
  const rows = deletableBackupRows(deviceId);
  const deleted = deleteBackupRows(rows);
  return { deleted, skipped: countActiveBackups(deviceId) };
}

/** Delete every non-active backup in the system. Active runs are skipped. */
export function deleteAllBackups(): { deleted: number; skipped: number } {
  const rows = deletableBackupRows();
  const deleted = deleteBackupRows(rows);
  return { deleted, skipped: countActiveBackups() };
}

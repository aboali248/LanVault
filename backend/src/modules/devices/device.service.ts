import { randomUUID } from "node:crypto";
import { db } from "../../database/connection";
import type { DeviceRow, DiskInput, DiskRow } from "../../types/domain";
import { AppError, assertFound } from "../../utils/errors";
import { parseJson } from "../../utils/json";
import { getPublishedAgentIfAvailable, getPublishedAgent } from "../agents/agent-update.service";
import { normalizeFileExtensions } from "../backups/file-exclusions";

interface DeviceWithGroupRow extends DeviceRow {
  group_name: string | null;
}

export interface DeviceApi {
  id: string;
  computerName: string;
  windowsUsername: string | null;
  ipAddress: string | null;
  macAddress: string | null;
  operatingSystem: string | null;
  approvalStatus: DeviceRow["approval_status"];
  status: DeviceRow["status"];
  agentStatus: DeviceRow["agent_status"];
  agentVersion: string | null;
  agentBuildHash: string | null;
  latestAgentVersion: string | null;
  agentUpdateAvailable: boolean;
  agentUpdateStatus: DeviceRow["agent_update_status"];
  agentUpdateError: string | null;
  backupExcludedExtensions: string[];
  backupIncludedExtensions: string[];
  continuousBackupEnabled: boolean;
  backupIntervalMinutes: number | null;
  archiveMode: "off" | "zip";
  hasArchivePassword: boolean;
  lastSeenAt: string | null;
  group: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
  disks?: DiskApi[];
}

export interface DiskApi {
  id: string;
  key: string;
  name: string;
  letter: string | null;
  fileSystem: string | null;
  totalBytes: number | null;
  freeBytes: number | null;
  isSelected: boolean;
  createdAt: string;
  updatedAt: string;
}

const deviceSelect = `
  SELECT d.*, g.name AS group_name
  FROM devices d
  LEFT JOIN groups g ON g.id = d.group_id
`;

export function toDiskApi(row: DiskRow): DiskApi {
  return {
    id: row.id,
    key: row.disk_key,
    name: row.name,
    letter: row.letter,
    fileSystem: row.file_system,
    totalBytes: row.total_bytes,
    freeBytes: row.free_bytes,
    isSelected: Boolean(row.is_selected),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toDeviceApi(row: DeviceWithGroupRow, disks?: DiskRow[]): DeviceApi {
  const published = getPublishedAgentIfAvailable();
  const agentUpdateAvailable = Boolean(published && row.agent_version &&
    row.agent_build_hash?.toUpperCase() !== published.buildHash);
  return {
    id: row.id,
    computerName: row.computer_name,
    windowsUsername: row.windows_username,
    ipAddress: row.ip_address,
    macAddress: row.mac_address,
    operatingSystem: row.operating_system,
    approvalStatus: row.approval_status,
    status: row.status,
    agentStatus: row.agent_status,
    agentVersion: row.agent_version,
    agentBuildHash: row.agent_build_hash,
    latestAgentVersion: published?.version ?? null,
    agentUpdateAvailable,
    agentUpdateStatus: row.agent_update_status === "current" && agentUpdateAvailable
      ? null
      : row.agent_update_status,
    agentUpdateError: row.agent_update_error,
    backupExcludedExtensions: normalizeFileExtensions(parseJson<unknown>(row.backup_excluded_extensions, [])),
    backupIncludedExtensions: normalizeFileExtensions(parseJson<unknown>(row.backup_included_extensions, [])),
    continuousBackupEnabled: Boolean(row.continuous_backup_enabled),
    backupIntervalMinutes: row.backup_interval_minutes,
    archiveMode: row.archive_mode === "zip" ? "zip" : "off",
    hasArchivePassword: Boolean(row.archive_password),
    lastSeenAt: row.last_seen_at,
    group: row.group_id && row.group_name ? { id: row.group_id, name: row.group_name } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(disks ? { disks: disks.map(toDiskApi) } : {}),
  };
}

export function getDeviceRow(id: string): DeviceRow | undefined {
  return db.prepare("SELECT * FROM devices WHERE id = ?").get(id) as DeviceRow | undefined;
}

export function getDevice(id: string, includeDisks = true): DeviceApi {
  const row = assertFound(
    db.prepare(`${deviceSelect} WHERE d.id = ?`).get(id) as DeviceWithGroupRow | undefined,
    "Device not found",
  );
  const disks = includeDisks
    ? (db.prepare("SELECT * FROM disks WHERE device_id = ? ORDER BY COALESCE(letter, ''), name").all(id) as DiskRow[])
    : undefined;
  return toDeviceApi(row, disks);
}

export function listDevices(options: {
  search?: string;
  approvalStatus?: DeviceRow["approval_status"];
  status?: DeviceRow["status"];
  groupId?: string;
  limit: number;
  offset: number;
}): { rows: DeviceApi[]; total: number } {
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (options.search) {
    clauses.push("(d.computer_name LIKE ? OR d.windows_username LIKE ? OR d.ip_address LIKE ? OR d.mac_address LIKE ?)");
    const search = `%${options.search}%`;
    values.push(search, search, search, search);
  }
  if (options.approvalStatus) {
    clauses.push("d.approval_status = ?");
    values.push(options.approvalStatus);
  }
  if (options.status) {
    clauses.push("d.status = ?");
    values.push(options.status);
  }
  if (options.groupId) {
    clauses.push("d.group_id = ?");
    values.push(options.groupId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const total = (db.prepare(`SELECT COUNT(*) AS count FROM devices d ${where}`).get(...values) as { count: number }).count;
  const rows = db.prepare(`${deviceSelect} ${where} ORDER BY d.computer_name COLLATE NOCASE LIMIT ? OFFSET ?`)
    .all(...values, options.limit, options.offset) as DeviceWithGroupRow[];
  const selectDisks = db.prepare("SELECT * FROM disks WHERE device_id = ? ORDER BY COALESCE(letter, ''), name");
  return {
    rows: rows.map((row) => toDeviceApi(row, selectDisks.all(row.id) as DiskRow[])),
    total,
  };
}

export function listDisks(deviceId: string): DiskApi[] {
  assertFound(getDeviceRow(deviceId), "Device not found");
  return (db.prepare("SELECT * FROM disks WHERE device_id = ? ORDER BY COALESCE(letter, ''), name").all(deviceId) as DiskRow[]).map(toDiskApi);
}

export function upsertDisks(deviceId: string, disks: DiskInput[]): void {
  if (disks.length === 0) return;
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO disks (id, device_id, disk_key, name, letter, file_system, total_bytes, free_bytes, is_selected, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    ON CONFLICT(device_id, disk_key) DO UPDATE SET
      name = excluded.name,
      letter = excluded.letter,
      file_system = excluded.file_system,
      total_bytes = excluded.total_bytes,
      free_bytes = excluded.free_bytes,
      updated_at = excluded.updated_at
  `);
  const run = db.transaction((items: DiskInput[]) => {
    for (const disk of items) {
      insert.run(
        randomUUID(),
        deviceId,
        disk.id,
        disk.name,
        disk.letter ?? null,
        disk.fileSystem ?? null,
        disk.totalBytes ?? null,
        disk.freeBytes ?? null,
        now,
        now,
      );
    }
  });
  run(disks);
}

export function createDevice(input: {
  computerName: string;
  windowsUsername?: string | null;
  ipAddress?: string | null;
  macAddress?: string | null;
  operatingSystem?: string | null;
  groupId?: string | null;
  disks?: DiskInput[];
}): DeviceApi {
  if (input.groupId) assertGroupExists(input.groupId);
  const now = new Date().toISOString();
  const id = randomUUID();
  try {
    db.prepare(`
      INSERT INTO devices (
        id, computer_name, windows_username, ip_address, mac_address, operating_system,
        approval_status, status, agent_status, group_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 'offline', 'offline', ?, ?, ?)
    `).run(
      id,
      input.computerName,
      input.windowsUsername ?? null,
      input.ipAddress ?? null,
      input.macAddress ?? null,
      input.operatingSystem ?? null,
      input.groupId ?? null,
      now,
      now,
    );
  } catch (error) {
    if (isUniqueConstraint(error)) throw new AppError(409, "A device with that MAC address already exists");
    throw error;
  }
  // Disks deliberately start unselected; administrators must opt in after discovery.
  upsertDisks(id, input.disks ?? []);
  return getDevice(id);
}

export function updateDevice(
  id: string,
  input: Partial<{
    computerName: string;
    windowsUsername: string | null;
    ipAddress: string | null;
    macAddress: string | null;
    operatingSystem: string | null;
    groupId: string | null;
  }>,
): DeviceApi {
  assertFound(getDeviceRow(id), "Device not found");
  if (input.groupId) assertGroupExists(input.groupId);
  const columns: string[] = [];
  const values: unknown[] = [];
  const fields: Record<string, string> = {
    computerName: "computer_name",
    windowsUsername: "windows_username",
    ipAddress: "ip_address",
    macAddress: "mac_address",
    operatingSystem: "operating_system",
    groupId: "group_id",
  };
  for (const [key, column] of Object.entries(fields)) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      columns.push(`${column} = ?`);
      values.push(input[key as keyof typeof input]);
    }
  }
  if (!columns.length) return getDevice(id);
  columns.push("updated_at = ?");
  values.push(new Date().toISOString(), id);
  try {
    db.prepare(`UPDATE devices SET ${columns.join(", ")} WHERE id = ?`).run(...values);
  } catch (error) {
    if (isUniqueConstraint(error)) throw new AppError(409, "A device with that MAC address already exists");
    throw error;
  }
  return getDevice(id);
}

export function setApproval(id: string, approvalStatus: DeviceRow["approval_status"]): DeviceApi {
  assertFound(getDeviceRow(id), "Device not found");
  db.prepare("UPDATE devices SET approval_status = ?, updated_at = ? WHERE id = ?")
    .run(approvalStatus, new Date().toISOString(), id);
  return getDevice(id);
}

export function queueDeviceAgentUpdate(id: string): { alreadyQueued: boolean } {
  const device = assertFound(db.prepare(`
    SELECT id, approval_status, status, agent_build_hash, agent_update_status FROM devices WHERE id = ?
  `).get(id) as {
    id: string; approval_status: string; status: string; agent_build_hash: string | null; agent_update_status: string | null;
  } | undefined, "Device not found");
  if (device.approval_status !== "approved") throw new AppError(409, "Only approved devices can be updated");
  if (device.status !== "online") throw new AppError(409, "The device must be online to receive an Agent update");

  const published = getPublishedAgent();
  if (device.agent_build_hash?.toUpperCase() === published.buildHash) {
    throw new AppError(409, "This device already has the current Agent build");
  }
  if (device.agent_update_status && ["queued", "downloading", "installing"].includes(device.agent_update_status)) {
    return { alreadyQueued: true };
  }
  const activeBackup = db.prepare(`
    SELECT id FROM backups WHERE device_id = ? AND status IN ('queued', 'running', 'cancel_requested') LIMIT 1
  `).get(id);
  if (activeBackup) throw new AppError(409, "Stop or finish the active backup before updating the Agent");

  const pendingUpdate = db.prepare(`
    SELECT id FROM agent_commands
    WHERE device_id = ? AND type = 'update_agent' AND status IN ('pending', 'delivered', 'acknowledged')
    ORDER BY created_at DESC LIMIT 1
  `).get(id) as { id: string } | undefined;
  if (pendingUpdate) {
    return { alreadyQueued: true };
  }

  const now = new Date().toISOString();
  const commandId = randomUUID();
  db.prepare(`
    UPDATE devices SET agent_update_status = 'queued', agent_update_error = NULL, updated_at = ? WHERE id = ?
  `).run(now, id);
  db.prepare(`
    INSERT INTO agent_commands (id, device_id, backup_id, type, payload, status, created_at)
    VALUES (?, ?, NULL, 'update_agent', ?, 'pending', ?)
  `).run(commandId, id, JSON.stringify({
    buildHash: published.buildHash,
    version: published.version,
  }), now);
  return { alreadyQueued: false };
}

export function queueAllDeviceAgentUpdates(): {
  queued: string[];
  skipped: Array<{ deviceId: string; reason: string }>;
} {
  const published = getPublishedAgentIfAvailable();
  if (!published) throw new AppError(503, "The published Agent update is unavailable. Publish the Agent package on the server first.");
  const devices = db.prepare(`
    SELECT id FROM devices WHERE approval_status = 'approved' ORDER BY computer_name COLLATE NOCASE
  `).all() as Array<{ id: string }>;
  if (!devices.length) throw new AppError(422, "There are no approved devices to update");
  const queued: string[] = [];
  const skipped: Array<{ deviceId: string; reason: string }> = [];
  for (const device of devices) {
    try {
      const result = queueDeviceAgentUpdate(device.id);
      if (result.alreadyQueued) skipped.push({ deviceId: device.id, reason: "Update already queued" });
      else queued.push(device.id);
    } catch (error) {
      skipped.push({ deviceId: device.id, reason: error instanceof Error ? error.message : "Unable to queue update" });
    }
  }
  return { queued, skipped };
}

export function deleteDevice(id: string): void {
  assertFound(getDeviceRow(id), "Device not found");
  db.prepare("DELETE FROM devices WHERE id = ?").run(id);
}

export function setDiskSelection(deviceId: string, selections: Array<{ id: string; isSelected: boolean }>): DiskApi[] {
  assertFound(getDeviceRow(deviceId), "Device not found");
  const uniqueIds = new Set(selections.map((selection) => selection.id));
  if (uniqueIds.size !== selections.length) throw new AppError(400, "Disk selections must not repeat disk IDs");
  const current = db.prepare(`SELECT id FROM disks WHERE device_id = ? AND id IN (${selections.map(() => "?").join(",") || "NULL"})`)
    .all(deviceId, ...selections.map((selection) => selection.id)) as Array<{ id: string }>;
  if (current.length !== selections.length) throw new AppError(400, "One or more disks do not belong to this device");
  const update = db.prepare("UPDATE disks SET is_selected = ?, updated_at = ? WHERE id = ? AND device_id = ?");
  const now = new Date().toISOString();
  db.transaction((items: Array<{ id: string; isSelected: boolean }>) => {
    for (const selection of items) update.run(selection.isSelected ? 1 : 0, now, selection.id, deviceId);
  })(selections);
  return listDisks(deviceId);
}

export function setDeviceBackupExclusions(
  deviceId: string,
  input: { excludedExtensions: string[]; includedExtensions: string[] },
): DeviceApi {
  assertFound(getDeviceRow(deviceId), "Device not found");
  db.prepare(`
    UPDATE devices
    SET backup_excluded_extensions = ?, backup_included_extensions = ?, updated_at = ?
    WHERE id = ?
  `).run(
    JSON.stringify(input.excludedExtensions),
    JSON.stringify(input.includedExtensions),
    new Date().toISOString(),
    deviceId,
  );
  return getDevice(deviceId);
}

export function setDeviceContinuousBackup(
  deviceId: string,
  input: { enabled: boolean; intervalMinutes: number | null },
): DeviceApi {
  assertFound(getDeviceRow(deviceId), "Device not found");
  db.prepare(`
    UPDATE devices
    SET continuous_backup_enabled = ?, backup_interval_minutes = ?,
      continuous_backup_next_run_at = NULL, updated_at = ?
    WHERE id = ?
  `).run(
    input.enabled ? 1 : 0,
    input.intervalMinutes,
    new Date().toISOString(),
    deviceId,
  );
  return getDevice(deviceId);
}

export function setDeviceArchive(
  deviceId: string,
  input: { mode: "off" | "zip"; password?: string | null },
): DeviceApi {
  assertFound(getDeviceRow(deviceId), "Device not found");
  const password = typeof input.password === "string" && input.password ? input.password : null;
  db.prepare(`
    UPDATE devices
    SET archive_mode = ?, archive_password = ?, updated_at = ?
    WHERE id = ?
  `).run(input.mode, password, new Date().toISOString(), deviceId);
  return getDevice(deviceId);
}

export function getDeviceArchive(deviceId: string): { mode: "off" | "zip"; password: string | null } {
  const row = assertFound(getDeviceRow(deviceId), "Device not found");
  return {
    mode: row.archive_mode === "zip" ? "zip" : "off",
    password: row.archive_password,
  };
}

export function assertGroupExists(groupId: string): void {
  assertFound(db.prepare("SELECT id FROM groups WHERE id = ?").get(groupId) as { id: string } | undefined, "Group not found");
}

export function getGroupBackupConfig(groupId: string | null): Record<string, unknown> | null {
  if (!groupId) return null;
  const group = db.prepare("SELECT backup_config FROM groups WHERE id = ?").get(groupId) as { backup_config: string | null } | undefined;
  return group ? parseJson<Record<string, unknown>>(group.backup_config, {}) : null;
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

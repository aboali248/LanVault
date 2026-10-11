import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { db } from "../../database/connection";
import { AppError, assertFound } from "../../utils/errors";
import {
  assertBackupBelongsToDevice,
  backupFileLocation,
  normalizePrefix,
  resolveExistingBackupFile,
  resolveFile,
  type BackupFileLocation,
} from "./backup-paths";
import { hashFile, resolveReadableBlob } from "./backup-content";
import { getDeviceArchive } from "../devices/device.service";
import { extractZipToTemp } from "./backup-zip";
import { listBackupTree } from "./backup-inventory";

export function queueDeletedFileRestore(deviceId: string, fileIds: string[]): number {
  const device = assertFound(db.prepare("SELECT approval_status FROM devices WHERE id = ?")
    .get(deviceId) as { approval_status: string } | undefined, "Device not found");
  if (device.approval_status !== "approved") throw new AppError(409, "Only approved devices can receive restored files");
  const select = db.prepare(`
    SELECT id, drive, relative_path, source_backup_id, size_bytes, sha256
    FROM deleted_files
    WHERE id = ? AND device_id = ? AND restore_status IN ('deleted', 'failed')
  `);
  const insertCommand = db.prepare(`
    INSERT INTO agent_commands (id, device_id, backup_id, type, payload, status, created_at)
    VALUES (?, ?, NULL, 'restore_file', ?, 'pending', ?)
  `);
  const updateFile = db.prepare("UPDATE deleted_files SET restore_status = 'queued', restore_error = NULL WHERE id = ? AND device_id = ?");
  const now = new Date().toISOString();
  const queue = db.transaction((ids: string[]) => {
    let queued = 0;
    for (const id of ids) {
      const row = select.get(id, deviceId) as {
        id: string; drive: string; relative_path: string; source_backup_id: string;
        size_bytes: number | null; sha256: string | null;
      } | undefined;
      if (!row || row.size_bytes === null || !row.sha256) continue;
      const payload = JSON.stringify({
        deletedFileId: row.id,
        sourceBackupId: row.source_backup_id,
        drive: row.drive,
        relativePath: row.relative_path,
        sizeBytes: row.size_bytes,
        sha256: row.sha256,
      });
      insertCommand.run(randomUUID(), deviceId, payload, now);
      updateFile.run(id, deviceId);
      queued++;
    }
    return queued;
  });
  const queued = queue(fileIds);
  if (!queued) throw new AppError(409, "No deleted files are available to restore");
  return queued;
}

export async function getDeletedFileBackupPath(deviceId: string, deletedFileId: string): Promise<{
  path: string;
  release: () => void;
}> {
  const file = assertFound(db.prepare(`
    SELECT drive, relative_path, size_bytes, sha256 FROM deleted_files
    WHERE id = ? AND device_id = ? AND restore_status = 'queued'
  `).get(deletedFileId, deviceId) as {
    drive: string; relative_path: string; size_bytes: number | null; sha256: string | null;
  } | undefined, "Queued deleted file not found");
  if (file.size_bytes === null || !file.sha256) {
    throw new AppError(404, "The retained backup copy of this file is unavailable");
  }
  const candidateBackups = db.prepare("SELECT id FROM backups WHERE device_id = ? ORDER BY requested_at DESC LIMIT 20")
    .all(deviceId) as Array<{ id: string }>;
  const archive = getDeviceArchive(deviceId);
  for (const slot of ["primary", "secondary"] as const) {
    for (const candidate of candidateBackups) {
      let location;
      try {
        location = backupFileLocation(deviceId, candidate.id, file.drive, file.relative_path, slot);
      } catch (error) {
        if (error instanceof AppError && (error.statusCode === 400 || error.statusCode === 422)) continue;
        throw error;
      }
      const readable = resolveReadableBlob(location.backupDirectory, file.sha256);
      if (readable) return readable;
      const verified = await awaitVerifyMirror(location, candidate.id, file.size_bytes, file.sha256, archive);
      if (verified) return verified;
    }
  }
  throw new AppError(404, "The retained backup copy of this file is unavailable");
}

interface VersionRow {
  size_bytes: number;
  last_write_ticks: string | number;
  sha256: string;
}

function findFileVersionAsOf(deviceId: string, backupId: string, drive: string, relativePath: string): VersionRow | undefined {
  return db.prepare(`
    SELECT f.size_bytes, f.last_write_ticks, f.sha256
    FROM backup_files f
    JOIN backups b ON b.id = f.backup_id
    WHERE f.device_id = ? AND f.drive = ? AND f.relative_path = ? COLLATE NOCASE
      AND b.device_id = ? AND b.status IN ('completed', 'cancelled', 'failed')
      AND datetime(b.requested_at) <= datetime((SELECT requested_at FROM backups WHERE id = ? AND device_id = ?))
    ORDER BY b.requested_at DESC, b.created_at DESC
    LIMIT 1
  `).get(deviceId, drive.toUpperCase(), relativePath, deviceId, backupId, deviceId) as VersionRow | undefined;
}

export async function getBackupFilePath(deviceId: string, backupId: string, drive: string, relativePath: string): Promise<{
  path: string;
  release: () => void;
}> {
  assertBackupBelongsToDevice(deviceId, backupId);
  const row = assertFound(
    findFileVersionAsOf(deviceId, backupId, drive, relativePath),
    "File version not found in this backup",
  );
  const archive = getDeviceArchive(deviceId);
  for (const slot of ["primary", "secondary"] as const) {
    try {
      const location = backupFileLocation(deviceId, backupId, drive, relativePath, slot);
      const readable = resolveReadableBlob(location.backupDirectory, row.sha256);
      if (readable) return readable;
    } catch (error) {
      if (!(error instanceof AppError) || error.statusCode !== 422) throw error;
    }
  }
  for (const slot of ["primary", "secondary"] as const) {
    try {
      const location = backupFileLocation(deviceId, backupId, drive, relativePath, slot);
      const verified = await awaitVerifyMirror(location, backupId, row.size_bytes, row.sha256, archive);
      if (verified) return verified;
    } catch (error) {
      if (!(error instanceof AppError) || error.statusCode !== 422) throw error;
    }
  }
  throw new AppError(404, "The retained backup copy of this file is unavailable");
}

async function awaitVerifyMirror(
  location: BackupFileLocation,
  backupId: string,
  sizeBytes: number,
  sha256: string,
  archive: { mode: "off" | "zip"; password: string | null },
): Promise<{ path: string; release: () => void } | null> {
  if (archive.mode === "zip") {
    const zipPath = `${resolveFile(location)}.zip`;
    if (!fs.existsSync(zipPath)) return null;
    let extracted: { path: string; release: () => void } | null = null;
    try {
      extracted = extractZipToTemp(zipPath, archive.password);
      const stat = fs.statSync(extracted.path);
      if (!stat.isFile() || stat.size !== sizeBytes) {
        extracted.release();
        return null;
      }
      if ((await hashFile(extracted.path)) !== sha256.toLowerCase()) {
        extracted.release();
        return null;
      }
      return extracted;
    } catch {
      try {
        extracted?.release();
      } catch {
        // Temporary cleanup is best effort.
      }
      return null;
    }
  }
  const pathForFile = resolveExistingBackupFile(location, backupId);
  if (fs.existsSync(pathForFile)) return { path: pathForFile, release: () => undefined };
  return null;
}

export function completeDeletedFileRestore(deviceId: string, deletedFileId: string, errorMessage?: string): void {
  const file = assertFound(db.prepare("SELECT id, restore_status FROM deleted_files WHERE id = ? AND device_id = ?")
    .get(deletedFileId, deviceId) as { id: string; restore_status: string } | undefined, "Deleted file not found");
  if (file.restore_status === "restored") return;
  if (file.restore_status !== "queued" && file.restore_status !== "failed") {
    throw new AppError(409, "Deleted file restore is not queued");
  }
  db.prepare(`
    UPDATE deleted_files SET restore_status = ?, restore_error = ?, restored_at = ?
    WHERE id = ? AND device_id = ?
  `).run(
    errorMessage ? "failed" : "restored",
    errorMessage ?? null,
    errorMessage ? null : new Date().toISOString(),
    file.id,
    deviceId,
  );
}

export function queueBackupFileRestore(deviceId: string, items: Array<{
  backupId: string;
  drive: string;
  relativePath?: string;
  prefix?: string;
}>): number {
  const device = assertFound(db.prepare("SELECT approval_status FROM devices WHERE id = ?")
    .get(deviceId) as { approval_status: string } | undefined, "Device not found");
  if (device.approval_status !== "approved") throw new AppError(409, "Only approved devices can receive restored files");
  const insertCommand = db.prepare(`
    INSERT INTO agent_commands (id, device_id, backup_id, type, payload, status, created_at)
    VALUES (?, ?, ?, 'restore_file', ?, 'pending', ?)
  `);
  const now = new Date().toISOString();
  const queue = db.transaction((entries: typeof items) => {
    let queued = 0;
    for (const entry of entries) {
      assertBackupBelongsToDevice(deviceId, entry.backupId);
      const drive = entry.drive.toUpperCase();
      if (!/^[A-Z]$/.test(drive)) throw new AppError(400, "Invalid source drive");
      if (entry.prefix !== undefined) {
        const prefix = normalizePrefix(entry.prefix);
        const state = listBackupTree(deviceId, entry.backupId, { drive, prefix, limit: 1000, offset: 0, recursive: true });
        const rows = state.files;
        if (!rows.length) throw new AppError(404, "No backed-up files found in this folder");
        for (const row of rows) {
          insertCommand.run(randomUUID(), deviceId, entry.backupId, JSON.stringify({
            backupId: entry.backupId,
            drive: row.drive,
            relativePath: row.relativePath,
            sizeBytes: row.sizeBytes,
            sha256: row.sha256,
          }), now);
          queued++;
        }
        continue;
      }
      if (!entry.relativePath?.trim()) throw new AppError(400, "File path is required");
      const row = findFileVersionAsOf(deviceId, entry.backupId, drive, entry.relativePath);
      if (!row) throw new AppError(404, "File version not found in this backup");
      insertCommand.run(randomUUID(), deviceId, entry.backupId, JSON.stringify({
        backupId: entry.backupId,
        drive,
        relativePath: entry.relativePath,
        sizeBytes: row.size_bytes,
        sha256: row.sha256,
      }), now);
      queued++;
    }
    return queued;
  });
  const queued = queue(items);
  if (!queued) throw new AppError(409, "No backup files are available to restore");
  return queued;
}

import { randomUUID } from "node:crypto";
import { db } from "../../database/connection";
import { AppError, assertFound } from "../../utils/errors";
import { parseJson } from "../../utils/json";
import { assertBackupBelongsToDevice, normalizePrefix } from "./backup-paths";
import { isExcludedFile, normalizeFileExtensions } from "./file-exclusions";

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export function listBackupFiles(deviceId: string, backupId: string, options: {
  search?: string;
  limit: number;
  offset: number;
}): {
  items: Array<{ drive: string; relativePath: string; name: string; sizeBytes: number; sha256: string }>;
  total: number;
} {
  assertBackupBelongsToDevice(deviceId, backupId);
  const clauses = ["backup_id = ?", "device_id = ?"];
  const values: unknown[] = [backupId, deviceId];
  const search = options.search?.trim();
  if (search) {
    clauses.push("relative_path LIKE ? ESCAPE '\\'");
    values.push(`%${escapeLike(search)}%`);
  }
  const where = `WHERE ${clauses.join(" AND ")}`;
  const total = (db.prepare(`SELECT COUNT(*) AS count FROM backup_files ${where}`).get(...values) as { count: number }).count;
  const rows = db.prepare(`
    SELECT drive, relative_path, size_bytes, sha256 FROM backup_files
    ${where} ORDER BY relative_path COLLATE NOCASE LIMIT ? OFFSET ?
  `).all(...values, options.limit, options.offset) as Array<{
    drive: string; relative_path: string; size_bytes: number; sha256: string;
  }>;
  return {
    items: rows.map((row) => {
      const normalized = row.relative_path.replace(/\\/g, "/");
      return {
        drive: row.drive,
        relativePath: row.relative_path,
        name: normalized.slice(normalized.lastIndexOf("/") + 1),
        sizeBytes: row.size_bytes,
        sha256: row.sha256,
      };
    }),
    total,
  };
}

export function listDeletedFiles(deviceId: string, limit: number, offset: number) {
  const total = (db.prepare("SELECT COUNT(*) AS count FROM deleted_files WHERE device_id = ? AND restore_status IN ('deleted', 'failed', 'queued')")
    .get(deviceId) as { count: number }).count;
  const rows = db.prepare(`
    SELECT id, drive, relative_path, source_backup_id, detected_at, restore_status, restore_error
    FROM deleted_files
    WHERE device_id = ? AND restore_status IN ('deleted', 'failed', 'queued')
    ORDER BY detected_at DESC, relative_path COLLATE NOCASE
    LIMIT ? OFFSET ?
  `).all(deviceId, limit, offset) as Array<{
    id: string; drive: string; relative_path: string; source_backup_id: string;
    detected_at: string; restore_status: string; restore_error: string | null;
  }>;
  return {
    items: rows.map((row) => ({
      id: row.id,
      deviceId,
      drive: row.drive,
      relativePath: row.relative_path,
      sourceBackupId: row.source_backup_id,
      detectedAt: row.detected_at,
      restoreStatus: row.restore_status,
      restoreError: row.restore_error,
    })),
    total,
  };
}

export function listBackupTree(deviceId: string, backupId: string, options: {
  drive?: string;
  prefix?: string;
  limit: number;
  offset: number;
  recursive?: boolean;
}): {
  drives: Array<{ drive: string; fileCount: number }>;
  directories: string[];
  files: Array<{ drive: string; relativePath: string; name: string; sizeBytes: number; sha256: string; lastWriteTicks: string }>;
  totalFiles: number;
} {
  assertBackupBelongsToDevice(deviceId, backupId);
  const asOf = (db.prepare("SELECT requested_at FROM backups WHERE id = ? AND device_id = ?")
    .get(backupId, deviceId) as { requested_at: string } | undefined)?.requested_at;
  if (!asOf) throw new AppError(404, "Backup not found");
  const stateRows = db.prepare(`
    WITH ranked AS (
      SELECT f.drive, f.relative_path, f.size_bytes, f.sha256, f.last_write_ticks,
        ROW_NUMBER() OVER (PARTITION BY f.drive, f.relative_path ORDER BY b.requested_at DESC, b.created_at DESC) AS rn
      FROM backup_files f
      JOIN backups b ON b.id = f.backup_id
      WHERE f.device_id = ? AND b.device_id = ?
        AND b.status IN ('completed', 'cancelled', 'failed')
        AND datetime(b.requested_at) <= datetime(?)
    )
    SELECT drive, relative_path, size_bytes, sha256, last_write_ticks FROM ranked WHERE rn = 1
  `).all(deviceId, deviceId, asOf) as Array<{
    drive: string; relative_path: string; size_bytes: number; sha256: string; last_write_ticks: string | number;
  }>;
  const driveCounts = new Map<string, number>();
  for (const row of stateRows) driveCounts.set(row.drive, (driveCounts.get(row.drive) ?? 0) + 1);
  const drives = [...driveCounts.entries()]
    .map(([drive, fileCount]) => ({ drive, fileCount }))
    .sort((a, b) => a.drive.localeCompare(b.drive));
  const directories: string[] = [];
  let files: Array<{ drive: string; relativePath: string; name: string; sizeBytes: number; sha256: string; lastWriteTicks: string }> = [];
  let totalFiles = stateRows.length;
  const drive = options.drive?.toUpperCase();
  if (drive) {
    if (!/^[A-Z]$/.test(drive)) throw new AppError(400, "Invalid source drive");
    const prefix = normalizePrefix(options.prefix);
    const seenDirs = new Set<string>();
    const fileRows: typeof stateRows = [];
    for (const row of stateRows) {
      if (row.drive !== drive) continue;
      const normalized = row.relative_path.replace(/\\/g, "/");
      if (prefix && !normalized.toLowerCase().startsWith(prefix.toLowerCase())) continue;
      const remainder = normalized.slice(prefix.length);
      if (options.recursive || remainder.indexOf("/") === -1) {
        fileRows.push(row);
        continue;
      }
      seenDirs.add(remainder.slice(0, remainder.indexOf("/")));
    }
    fileRows.sort((a, b) => a.relative_path.localeCompare(b.relative_path));
    totalFiles = fileRows.length;
    files = fileRows.slice(options.offset, options.offset + options.limit).map((row) => {
      const normalized = row.relative_path.replace(/\\/g, "/");
      return {
        drive,
        relativePath: row.relative_path,
        name: normalized.slice(normalized.lastIndexOf("/") + 1),
        sizeBytes: row.size_bytes,
        sha256: row.sha256,
        lastWriteTicks: String(row.last_write_ticks),
      };
    });
    directories.push(...[...seenDirs].sort((a, b) => a.localeCompare(b)));
  }
  return { drives, directories, files, totalFiles };
}

export function listFileVersions(deviceId: string, drive: string, relativePath: string, limit: number, offset: number): {
  items: Array<{
    backupId: string;
    drive: string;
    relativePath: string;
    sizeBytes: number;
    sha256: string;
    lastWriteTicks: string;
    mode: string;
    status: string;
    requestedAt: string;
    completedAt: string | null;
  }>;
  total: number;
} {
  if (!/^[a-z]$/i.test(drive)) throw new AppError(400, "Invalid source drive");
  if (!relativePath.trim()) throw new AppError(400, "File path is required");
  const total = (db.prepare(`
    SELECT COUNT(*) AS count FROM backup_files WHERE device_id = ? AND drive = ? AND relative_path = ? COLLATE NOCASE
  `).get(deviceId, drive.toUpperCase(), relativePath) as { count: number }).count;
  const rows = db.prepare(`
    SELECT f.backup_id, f.drive, f.relative_path, f.size_bytes, f.sha256, f.last_write_ticks,
      b.mode, b.status, b.requested_at, b.completed_at
    FROM backup_files f
    JOIN backups b ON b.id = f.backup_id
    WHERE f.device_id = ? AND f.drive = ? AND f.relative_path = ? COLLATE NOCASE
    ORDER BY b.requested_at DESC, b.created_at DESC
    LIMIT ? OFFSET ?
  `).all(deviceId, drive.toUpperCase(), relativePath, limit, offset) as Array<{
    backup_id: string; drive: string; relative_path: string; size_bytes: number;
    sha256: string; last_write_ticks: string | number; mode: string; status: string;
    requested_at: string; completed_at: string | null;
  }>;
  return {
    items: rows.map((row) => ({
      backupId: row.backup_id,
      drive: row.drive,
      relativePath: row.relative_path,
      sizeBytes: row.size_bytes,
      sha256: row.sha256,
      lastWriteTicks: String(row.last_write_ticks),
      mode: row.mode,
      status: row.status,
      requestedAt: row.requested_at,
      completedAt: row.completed_at,
    })),
    total,
  };
}

export function recordDeletedFiles(deviceId: string, backupId: string, inventoryMode?: "full" | "delta"): number {  // Agents that report deletions explicitly (full manifest diff or USN journal)
  // send inventoryMode; inferring from the recorded set would then flag every
  // unchanged file as deleted, so inference only runs for legacy full uploads.
  if (inventoryMode !== undefined) return 0;
  const previous = db.prepare(`
    SELECT b.id FROM backups b
    WHERE b.device_id = ? AND b.status = 'completed' AND b.id != ?
    ORDER BY b.completed_at DESC, b.requested_at DESC LIMIT 1
  `).get(deviceId, backupId) as { id: string } | undefined;
  if (!previous) return 0;
  const priorFiles = db.prepare(`
    SELECT drive, relative_path, size_bytes, sha256 FROM backup_files WHERE backup_id = ?
  `).all(previous.id) as Array<{ drive: string; relative_path: string; size_bytes: number; sha256: string }>;
  const command = db.prepare(`
    SELECT payload FROM agent_commands WHERE backup_id = ? AND type = 'backup'
  `).get(backupId) as { payload: string } | undefined;
  const payload = parseJson<{ excludedExtensions?: unknown }>(command?.payload ?? null, {});
  const excludedExtensions = new Set(normalizeFileExtensions(payload.excludedExtensions));
  const currentFiles = new Set((db.prepare(`
    SELECT drive || ':' || relative_path AS path FROM backup_files WHERE backup_id = ?
  `).all(backupId) as Array<{ path: string }>).map((row) => row.path.toLocaleLowerCase()));
  const insertDeleted = db.prepare(`
    INSERT INTO deleted_files (id, device_id, drive, relative_path, source_backup_id, size_bytes, sha256, detected_at, restore_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'deleted')
    ON CONFLICT(device_id, drive, relative_path) DO UPDATE SET
      source_backup_id = excluded.source_backup_id,
      size_bytes = excluded.size_bytes,
      sha256 = excluded.sha256,
      detected_at = excluded.detected_at,
      restore_status = CASE WHEN deleted_files.restore_status = 'queued' THEN 'queued' ELSE 'deleted' END,
      restore_error = CASE WHEN deleted_files.restore_status = 'queued' THEN deleted_files.restore_error ELSE NULL END,
      restored_at = CASE WHEN deleted_files.restore_status = 'queued' THEN deleted_files.restored_at ELSE NULL END
  `);
  const markMissing = db.transaction(() => {
    let newlyDeleted = 0;
    for (const file of priorFiles) {
      if (isExcludedFile(file.relative_path, excludedExtensions)) continue;
      if (!currentFiles.has(`${file.drive}:${file.relative_path}`.toLocaleLowerCase())) {
        const existing = db.prepare(`
          SELECT restore_status FROM deleted_files
          WHERE device_id = ? AND drive = ? AND relative_path = ? COLLATE NOCASE
        `).get(deviceId, file.drive, file.relative_path) as { restore_status: string } | undefined;
        if (!existing || existing.restore_status === "restored") newlyDeleted++;
        insertDeleted.run(randomUUID(), deviceId, file.drive, file.relative_path, previous.id, file.size_bytes, file.sha256, new Date().toISOString());
      }
    }
    for (const row of currentFiles) {
      const separator = row.indexOf(":");
      const drive = row.slice(0, separator);
      const relativePath = row.slice(separator + 1);
      const markedRestored = db.prepare(`
        UPDATE deleted_files SET restore_status = 'restored', restore_error = NULL, restored_at = ?
        WHERE device_id = ? AND drive = ? AND relative_path = ? COLLATE NOCASE AND restore_status = 'queued'
      `).run(new Date().toISOString(), deviceId, drive, relativePath).changes > 0;
      if (!markedRestored) {
        db.prepare("DELETE FROM deleted_files WHERE device_id = ? AND drive = ? AND relative_path = ? COLLATE NOCASE")
          .run(deviceId, drive, relativePath);
      }
    }
    return newlyDeleted;
  });
  return markMissing();
}

/**
 * Silently drops an automatic run that protected nothing new: no file rows,
 * no warning/error logs, complete inventory. Manual runs (requested_by is
 * null) and runs without an older completed run are always kept. The
 * inventoryMode gate was dropped so older agents that do not report it are
 * covered too: legacy full uploads always record file rows, so they are
 * naturally kept by the fileCount check below. Live-state rows are repointed
 * at the previous completed backup before deletion.
 * Returns true when the run was removed.
 */
export function deleteEmptyBackupRun(deviceId: string, backupId: string, inventoryMode?: "full" | "delta"): boolean {
  void inventoryMode;
  const drop = db.transaction(() => {
    const backup = db.prepare("SELECT requested_by, status FROM backups WHERE id = ? AND device_id = ?")
      .get(backupId, deviceId) as { requested_by: string | null; status: string } | undefined;
    if (!backup || backup.status !== "completed" || !backup.requested_by) return false;
    const fileCount = (db.prepare("SELECT COUNT(*) AS count FROM backup_files WHERE backup_id = ?")
      .get(backupId) as { count: number }).count;
    if (fileCount > 0) return false;
    const warnCount = (db.prepare("SELECT COUNT(*) AS count FROM backup_logs WHERE backup_id = ? AND level IN ('warning', 'error')")
      .get(backupId) as { count: number }).count;
    if (warnCount > 0) return false;
    const referenced = db.prepare("SELECT 1 AS found FROM deleted_files WHERE source_backup_id = ? LIMIT 1")
      .get(backupId) as { found: number } | undefined;
    if (referenced) return false;
    const previous = db.prepare(`
      SELECT b.id FROM backups b
      WHERE b.device_id = ? AND b.status = 'completed' AND b.id != ?
      ORDER BY b.completed_at DESC, b.requested_at DESC LIMIT 1
    `).get(deviceId, backupId) as { id: string } | undefined;
    // Without an older completed run this empty row is the device's only
    // evidence, so it is kept.
    if (!previous) return false;
    const liveRefs = db.prepare("SELECT COUNT(*) AS count FROM file_current WHERE device_id = ? AND backup_id = ?")
      .get(deviceId, backupId) as { count: number };
    if (liveRefs.count > 0) {
      db.prepare("UPDATE file_current SET backup_id = ? WHERE device_id = ? AND backup_id = ?")
        .run(previous.id, deviceId, backupId);
    }
    db.prepare("DELETE FROM backups WHERE id = ? AND device_id = ?").run(backupId, deviceId);
    return true;
  });
  return drop();
}

export function reportDeletedPaths(deviceId: string, backupId: string, paths: Array<{ drive: string; relativePath: string }>): number {
  assertBackupBelongsToDevice(deviceId, backupId);
  const findCurrent = db.prepare(`
    SELECT backup_id, size_bytes, sha256 FROM file_current
    WHERE device_id = ? AND drive = ? AND relative_path = ? COLLATE NOCASE
  `);
  const insertDeleted = db.prepare(`
    INSERT INTO deleted_files (id, device_id, drive, relative_path, source_backup_id, size_bytes, sha256, detected_at, restore_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'deleted')
    ON CONFLICT(device_id, drive, relative_path) DO UPDATE SET
      source_backup_id = excluded.source_backup_id,
      size_bytes = excluded.size_bytes,
      sha256 = excluded.sha256,
      detected_at = excluded.detected_at,
      restore_status = CASE WHEN deleted_files.restore_status = 'queued' THEN 'queued' ELSE 'deleted' END,
      restore_error = CASE WHEN deleted_files.restore_status = 'queued' THEN deleted_files.restore_error ELSE NULL END,
      restored_at = CASE WHEN deleted_files.restore_status = 'queued' THEN deleted_files.restored_at ELSE NULL END
  `);
  const removeCurrent = db.prepare(`
    DELETE FROM file_current WHERE device_id = ? AND drive = ? AND relative_path = ? COLLATE NOCASE
  `);
  const mark = db.transaction((entries: typeof paths) => {
    let newlyDeleted = 0;
    for (const entry of entries) {
      const drive = entry.drive.toUpperCase();
      if (!/^[A-Z]$/.test(drive) || !entry.relativePath.trim()) continue;
      const current = findCurrent.get(deviceId, drive, entry.relativePath) as {
        backup_id: string; size_bytes: number; sha256: string;
      } | undefined;
      if (!current) continue;
      const existing = db.prepare(`
        SELECT restore_status FROM deleted_files
        WHERE device_id = ? AND drive = ? AND relative_path = ? COLLATE NOCASE
      `).get(deviceId, drive, entry.relativePath) as { restore_status: string } | undefined;
      if (!existing || existing.restore_status === "restored") newlyDeleted++;
      insertDeleted.run(randomUUID(), deviceId, drive, entry.relativePath, current.backup_id, current.size_bytes, current.sha256, new Date().toISOString());
      removeCurrent.run(deviceId, drive, entry.relativePath);
    }
    return newlyDeleted;
  });
  return mark(paths);
}

export function getDeviceProtection(deviceId: string): {
  protectedFiles: number;
  lastCompletedAt: string | null;
  lastStatus: string | null;
  queuedRestores: number;
} {
  const protectedFiles = (db.prepare("SELECT COUNT(*) AS count FROM file_current WHERE device_id = ?")
    .get(deviceId) as { count: number }).count;
  const last = db.prepare(`
    SELECT status, completed_at FROM backups
    WHERE device_id = ? AND status IN ('completed', 'failed', 'cancelled')
    ORDER BY COALESCE(completed_at, updated_at, requested_at) DESC LIMIT 1
  `).get(deviceId) as { status: string; completed_at: string | null } | undefined;
  const queuedRestores = (db.prepare(`
    SELECT COUNT(*) AS count FROM agent_commands
    WHERE device_id = ? AND type = 'restore_file' AND status IN ('pending', 'delivered', 'acknowledged')
  `).get(deviceId) as { count: number }).count;
  return {
    protectedFiles,
    lastCompletedAt: last?.completed_at ?? null,
    lastStatus: last?.status ?? null,
    queuedRestores,
  };
}

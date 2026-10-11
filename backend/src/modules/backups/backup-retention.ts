import fs from "node:fs";
import path from "node:path";
import { db } from "../../database/connection";
import { getConfiguredBackupDestination, getSettings } from "../settings/settings.service";
import { legacyMachineDirectory, resolveMachineDirectory } from "./backup-paths";
import { compressColdBlobs, consolidateDeviceBlobs } from "./backup-content";

function pruneStaleChunks(machineDirectory: string): void {
  try {
    const chunksRoot = path.join(machineDirectory, ".chunks");
    if (!fs.existsSync(chunksRoot)) return;
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const walk = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          try {
            if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
          } catch { /* Changed concurrently; ignore. */ }
        } else {
          try {
            if (fs.statSync(full).mtimeMs < cutoff) fs.rmSync(full, { force: true });
          } catch { /* Best effort cleanup. */ }
        }
      }
    };
    walk(chunksRoot);
  } catch { /* Chunk cleanup must never fail a backup. */ }
}

function resolveDestinations(deviceId: string, backupId: string): string[] {
  const currentBackup = db.prepare("SELECT destination FROM backups WHERE id = ? AND device_id = ?")
    .get(backupId, deviceId) as { destination: string | null } | undefined;
  if (!currentBackup) return [];
  const settings = getSettings().backup;
  const destinations = [
    currentBackup.destination?.trim() || getConfiguredBackupDestination(),
    settings.secondaryDestination?.trim() || null,
  ];
  return [...new Set(destinations.filter((item): item is string => Boolean(item)))];
}

/**
 * Always-safe maintenance after a completed backup: consolidates legacy
 * stores, compresses cold versions, and clears stale chunks. Version deletion
 * additionally requires a retention count (see pruneDeviceBackups).
 */
export function maintainBackupStorage(deviceId: string, backupId: string, retentionCount: number | null): void {
  try {
    for (const destination of resolveDestinations(deviceId, backupId)) {
      maintainSharedStore(destination);
    }
    if (retentionCount) pruneDeviceBackups(deviceId, backupId, retentionCount);
  } catch {
    // Storage maintenance must never fail a backup.
  }
}

export function pruneDeviceBackups(deviceId: string, currentBackupId: string, retentionCount: number): void {
  if (!Number.isSafeInteger(retentionCount) || retentionCount < 1) return;
  const device = db.prepare("SELECT computer_name FROM devices WHERE id = ?").get(deviceId) as { computer_name: string } | undefined;
  if (!device) return;
  const restoreSourceIds = new Set((db.prepare(`
    SELECT DISTINCT source_backup_id FROM deleted_files
    WHERE device_id = ? AND restore_status IN ('deleted', 'queued', 'failed')
  `).all(deviceId) as Array<{ source_backup_id: string }>).map((row) => row.source_backup_id));
  const destinations = resolveDestinations(deviceId, currentBackupId);
  for (const destination of destinations) {
    const machineDirectory = resolveMachineDirectory(destination, device.computer_name, deviceId, false)
      ?? legacyMachineDirectory(destination, device.computer_name, deviceId);
    if (!fs.existsSync(machineDirectory)) continue;
    const snapshots = fs.readdirSync(machineDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^[0-9a-f-]{36}$/i.test(entry.name))
      .map((entry) => ({
        id: entry.name,
        path: path.join(machineDirectory, entry.name),
        modifiedAt: fs.statSync(path.join(machineDirectory, entry.name)).mtimeMs,
      }))
      .sort((first, second) => second.modifiedAt - first.modifiedAt);
    const retainedIds = new Set([currentBackupId, ...restoreSourceIds, ...snapshots
      .filter((snapshot) => snapshot.id !== currentBackupId)
      .slice(0, Math.max(0, retentionCount - 1))
      .map((snapshot) => snapshot.id)]);
    for (const snapshot of snapshots) {
      if (!retainedIds.has(snapshot.id)) fs.rmSync(snapshot.path, { recursive: true, force: true });
    }
    pruneSharedStore(destination, retentionCount);
  }
}

const SHARED_PRUNE_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;

function collectRetainedShas(retentionCount: number): { keep: Set<string>; hot: Set<string> } {
  const keep = new Set<string>();
  const hot = new Set<string>();
  const devices = db.prepare("SELECT id FROM devices").all() as Array<{ id: string }>;
  for (const device of devices) {
    const retainedBackupIds = (db.prepare(`
      SELECT id FROM backups
      WHERE device_id = ? AND status IN ('completed', 'cancelled', 'failed')
      ORDER BY COALESCE(completed_at, updated_at, requested_at) DESC
      LIMIT ?
    `).all(device.id, retentionCount) as Array<{ id: string }>).map((row) => row.id);
    if (retainedBackupIds.length) {
      const placeholders = retainedBackupIds.map(() => "?").join(",");
      for (const row of db.prepare(`
        SELECT DISTINCT LOWER(sha256) AS sha256 FROM backup_files
        WHERE device_id = ? AND backup_id IN (${placeholders})
      `).all(device.id, ...retainedBackupIds) as Array<{ sha256: string }>) {
        keep.add(row.sha256);
      }
    }
  }
  // Current live state must survive even when its version predates retention.
  for (const row of db.prepare(`
    SELECT DISTINCT LOWER(sha256) AS sha256 FROM file_current
  `).all() as Array<{ sha256: string }>) {
    keep.add(row.sha256);
    hot.add(row.sha256);
  }
  for (const row of db.prepare(`
    SELECT DISTINCT LOWER(sha256) AS sha256 FROM deleted_files
    WHERE restore_status IN ('deleted', 'queued', 'failed') AND sha256 IS NOT NULL
  `).all() as Array<{ sha256: string }>) {
    keep.add(row.sha256);
  }
  return { keep, hot };
}

function collectLiveShas(): Set<string> {
  const hot = new Set<string>();
  for (const row of db.prepare(`
    SELECT DISTINCT LOWER(sha256) AS sha256 FROM file_current
  `).all() as Array<{ sha256: string }>) {
    hot.add(row.sha256);
  }
  return hot;
}

/**
 * Always-safe maintenance for a destination: consolidates legacy stores,
 * compresses versions that are no longer live, and clears stale chunks.
 * Throttled to one pass per interval. Never deletes retained versions.
 */
function maintainSharedStore(destination: string): void {
  try {
    const root = path.resolve(destination);
    const marker = path.join(root, ".blobs", ".last-shared-maintain");
    try {
      if (Date.now() - fs.statSync(marker).mtimeMs < SHARED_PRUNE_MIN_INTERVAL_MS) return;
    } catch {
      // First pass or unreadable marker: proceed.
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === ".blobs" || entry.name === ".chunks") continue;
      const machineDirectory = path.join(root, entry.name);
      consolidateDeviceBlobs(machineDirectory);
      pruneStaleChunks(machineDirectory);
    }
    const { compressed, savedBytes } = compressColdBlobs(root, collectLiveShas());
    if (compressed > 0) {
      console.info(`Compressed ${compressed} cold backup version(s), saving ${savedBytes} bytes in '${root}'.`);
    }
    try {
      fs.mkdirSync(path.dirname(marker), { recursive: true });
      fs.writeFileSync(marker, new Date().toISOString(), "utf8");
    } catch {
      // Marker is best effort; the next pass simply retries.
    }
  } catch {
    // Store maintenance must never fail a backup.
  }
}

/**
 * Maintains the shared per-destination content store: migrates legacy
 * per-device blobs, deletes versions outside retention, and compresses
 * versions that are no longer live. Throttled to one pass per interval.
 */
function pruneSharedStore(destination: string, retentionCount: number): void {
  maintainSharedStore(destination);
  try {
    const root = path.resolve(destination);
    const { keep } = collectRetainedShas(retentionCount);
    pruneSharedBlobs(root, keep);
  } catch {
    // Store maintenance must never fail a backup.
  }
}

function pruneSharedBlobs(storeDir: string, keep: Set<string>): void {
  const blobsRoot = path.join(storeDir, ".blobs");
  const walk = (directory: string): void => {
    let children: fs.Dirent[];
    try {
      children = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of children) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        try {
          if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
        } catch {
          // Directory changed concurrently; ignore.
        }
        continue;
      }
      if (entry.name.startsWith(".")) continue;
      const base = entry.name.toLowerCase().endsWith(".gz")
        ? entry.name.toLowerCase().slice(0, -".gz".length)
        : entry.name.toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(base) || keep.has(base)) continue;
      try {
        fs.rmSync(full, { force: true });
      } catch {
        // Best effort cleanup.
      }
    }
  };
  walk(blobsRoot);
}

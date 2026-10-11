import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "../../database/connection";
import { getConfiguredBackupDestination, getSettings } from "../settings/settings.service";
import { findRetainedBlob } from "./backup-content";
import { legacyMachineDirectory, resolveMachineDirectory } from "./backup-paths";

export interface ReplicationStatus {
  secondaryConfigured: boolean;
  pending: number;
  failed: number;
  checkedAt: string;
}

interface QueueItem {
  id: string;
  backup_id: string;
  device_id: string;
  computer_name: string;
  sha256: string;
  size_bytes: number | null;
  primary_destination: string;
  secondary_destination: string;
  attempts: number;
}

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 20;

/**
 * Queues every distinct content hash of a completed backup so the server can
 * copy it to the secondary destination in the background. The agent uploads
 * once (primary); the LAN is never used for the second copy.
 */
export function enqueueBackupReplication(backupId: string): number {
  const backup = db.prepare("SELECT id, device_id, destination FROM backups WHERE id = ?")
    .get(backupId) as { id: string; device_id: string; destination: string | null } | undefined;
  if (!backup) return 0;
  const secondary = getSettings().backup.secondaryDestination?.trim() || null;
  if (!secondary) return 0;
  const primary = backup.destination?.trim() || getConfiguredBackupDestination();
  if (!primary || primary.toLocaleLowerCase() === secondary.toLocaleLowerCase()) return 0;
  const rows = db.prepare("SELECT DISTINCT LOWER(sha256) AS sha256, size_bytes FROM backup_files WHERE backup_id = ?")
    .all(backupId) as Array<{ sha256: string; size_bytes: number | null }>;
  if (!rows.length) return 0;
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO replication_queue (
      id, backup_id, device_id, sha256, size_bytes,
      primary_destination, secondary_destination,
      status, attempts, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)
  `);
  return db.transaction(() => {
    let queued = 0;
    for (const row of rows) {
      const result = insert.run(
        randomUUID(), backup.id, backup.device_id, row.sha256, row.size_bytes,
        primary, secondary, now, now,
      );
      queued += Number(result.changes);
    }
    return queued;
  })();
}

function secondaryBlobPath(secondaryDestination: string, fileName: string): string {
  const normalized = fileName.toLowerCase();
  return path.join(path.resolve(secondaryDestination), ".blobs", normalized.slice(0, 2), normalized);
}

/** Raw and cold (.gz) candidates in the primary store, global before legacy. */
function findSourceBlob(primaryDeviceDir: string, sha256: string): { source: string; fileName: string } | null {
  const direct = findRetainedBlob(primaryDeviceDir, sha256);
  if (direct) return { source: direct, fileName: path.basename(direct) };
  const normalized = sha256.toLowerCase();
  const storeRoot = path.dirname(primaryDeviceDir);
  const candidates = [
    path.join(storeRoot, ".blobs", normalized.slice(0, 2), `${normalized}.gz`),
    path.join(primaryDeviceDir, ".blobs", normalized.slice(0, 2), `${normalized}.gz`),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return { source: candidate, fileName: path.basename(candidate) };
    } catch {
      // Missing candidate; try the next one.
    }
  }
  return null;
}

async function replicateOne(item: QueueItem): Promise<void> {
  const now = new Date().toISOString();
  db.prepare("UPDATE replication_queue SET status = 'copying', updated_at = ? WHERE id = ?").run(now, item.id);
  try {
    const sha = item.sha256.toLowerCase();
    const primaryDeviceDir = resolveMachineDirectory(
      item.primary_destination, item.computer_name, item.device_id, false,
    ) ?? legacyMachineDirectory(item.primary_destination, item.computer_name, item.device_id);
    if (!fs.existsSync(primaryDeviceDir)) {
      throw new Error("Primary device folder is missing");
    }
    const found = findSourceBlob(primaryDeviceDir, sha);
    if (!found) {
      throw new Error("Content is no longer present in the primary store");
    }
    const target = secondaryBlobPath(item.secondary_destination, found.fileName);
    if (fs.existsSync(target)) {
      db.prepare("UPDATE replication_queue SET status = 'done', updated_at = ? WHERE id = ?").run(new Date().toISOString(), item.id);
      return;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const staging = `${target}.${randomUUID()}.blob`;
    try {
      await fs.promises.copyFile(found.source, staging);
      const [sourceStat, stagedStat] = await Promise.all([
        fs.promises.stat(found.source),
        fs.promises.stat(staging),
      ]);
      if (stagedStat.size !== sourceStat.size) {
        throw new Error("Copied bytes do not match the source");
      }
      try {
        await fs.promises.rename(staging, target);
      } catch {
        if (!fs.existsSync(target)) throw new Error("Could not publish the replicated copy");
      }
    } finally {
      try {
        await fs.promises.rm(staging, { force: true });
      } catch {
        // Staging cleanup is best effort.
      }
    }
    db.prepare("UPDATE replication_queue SET status = 'done', last_error = NULL, updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), item.id);
  } catch (error) {
    const attempts = item.attempts + 1;
    const message = error instanceof Error ? error.message : "Unknown replication error";
    db.prepare(`
      UPDATE replication_queue
      SET status = ?, attempts = ?, last_error = ?, updated_at = ?
      WHERE id = ?
    `).run(
      attempts >= MAX_ATTEMPTS ? "failed" : "pending",
      attempts,
      message.slice(0, 500),
      new Date().toISOString(),
      item.id,
    );
  }
}

let running = false;

/**
 * Copies a small batch of pending blobs to the secondary store. Safe to call
 * on every scheduler tick; file copies are async so the API stays responsive.
 * Never throws.
 */
export async function runReplicationQueue(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const items = db.prepare(`
      SELECT q.id, q.backup_id, q.device_id, d.computer_name,
        q.sha256, q.size_bytes, q.primary_destination, q.secondary_destination, q.attempts
      FROM replication_queue q
      JOIN devices d ON d.id = q.device_id
      WHERE q.status = 'pending' AND q.attempts < ?
      ORDER BY q.created_at
      LIMIT ?
    `).all(MAX_ATTEMPTS, BATCH_SIZE) as QueueItem[];
    for (const item of items) {
      await replicateOne(item);
    }
  } catch (error) {
    console.error("Secondary replication pass failed:", error instanceof Error ? error.message : error);
  } finally {
    running = false;
  }
}

export function getReplicationStatus(): ReplicationStatus {
  const secondary = getSettings().backup.secondaryDestination?.trim() || null;
  const pending = (db.prepare("SELECT COUNT(*) AS count FROM replication_queue WHERE status IN ('pending', 'copying')")
    .get() as { count: number }).count;
  const failed = (db.prepare("SELECT COUNT(*) AS count FROM replication_queue WHERE status = 'failed'")
    .get() as { count: number }).count;
  return {
    secondaryConfigured: Boolean(secondary),
    pending: Number(pending),
    failed: Number(failed),
    checkedAt: new Date().toISOString(),
  };
}

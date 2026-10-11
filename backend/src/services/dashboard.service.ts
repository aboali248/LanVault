import fs from "node:fs";
import { db } from "../database/connection";
import { getSettings } from "../modules/settings/settings.service";
import { inspectConfiguredStorage } from "../modules/settings/storage.service";
import { countUnreadNotifications, listNotifications } from "./notification.service";
import { listBackupRows } from "../modules/backups/backup.service";

function count(sql: string, ...params: unknown[]): number {
  return (db.prepare(sql).get(...params) as { count: number }).count;
}

function inspectStorage(destination: string | null) {
  if (!destination) return { configured: false, destination: null, available: false, totalBytes: null, freeBytes: null };
  try {
    const stat = fs.statfsSync(destination);
    return {
      configured: true,
      destination,
      available: true,
      totalBytes: Number(stat.blocks) * Number(stat.bsize),
      freeBytes: Number(stat.bavail) * Number(stat.bsize),
    };
  } catch {
    return { configured: true, destination, available: false, totalBytes: null, freeBytes: null };
  }
}

export function getDashboardSummary() {
  const deviceCount = count("SELECT COUNT(*) AS count FROM devices");
  const onlineCount = count("SELECT COUNT(*) AS count FROM devices WHERE status IN ('online', 'busy')");
  const offlineCount = count("SELECT COUNT(*) AS count FROM devices WHERE status = 'offline'");
  const backupCount = count("SELECT COUNT(*) AS count FROM backups");
  const activeBackupCount = count("SELECT COUNT(*) AS count FROM backups WHERE status IN ('queued', 'running', 'cancel_requested')");
  const failedBackupCount = count("SELECT COUNT(*) AS count FROM backups WHERE status = 'failed'");
  const recentBackups = listBackupRows({ limit: 8, offset: 0 }).rows;
  const errors = db.prepare(`
    SELECT l.id, l.message, l.created_at, b.id AS backup_id, d.computer_name
    FROM backup_logs l
    INNER JOIN backups b ON b.id = l.backup_id
    INNER JOIN devices d ON d.id = b.device_id
    WHERE l.level = 'error'
    ORDER BY l.created_at DESC
    LIMIT 8
  `).all() as Array<{ id: string; message: string; created_at: string; backup_id: string; computer_name: string }>;
  const configuredStorage = getSettings().backup;
  const primaryStorage = inspectStorage(configuredStorage.destination);
  const secondaryStorage = inspectStorage(configuredStorage.secondaryDestination);
  const storageStatus = inspectConfiguredStorage(configuredStorage);
  const database = db.prepare("PRAGMA integrity_check").get() as Record<string, unknown>;
  const integrity = String(Object.values(database)[0] ?? "unknown");

  return {
    devices: { total: deviceCount, online: onlineCount, offline: offlineCount },
    backups: { total: backupCount, active: activeBackupCount, failed: failedBackupCount },
    recentBackups,
    storage: { ...primaryStorage, secondary: secondaryStorage },
    notifications: listNotifications({ includeResolved: false, limit: 10 }),
    unreadNotifications: countUnreadNotifications(),
    errors: errors.map((error) => ({
      id: error.id,
      backupId: error.backup_id,
      computerName: error.computer_name,
      message: error.message,
      occurredAt: error.created_at,
    })),
    system: {
      status: integrity === "ok"
        ? (failedBackupCount > 0 || !configuredStorage.destination || storageStatus.hasFailure ? "degraded" : "healthy")
        : "unhealthy",
      database: integrity === "ok" ? "connected" : "integrity_error",
      checkedAt: new Date().toISOString(),
    },
  };
}

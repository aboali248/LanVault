import { randomUUID } from "node:crypto";
import { db } from "../database/connection";
import { eventBus } from "./event-bus";
import { assertFound } from "../utils/errors";

export type NotificationType = "agent_offline" | "backup_failed" | "storage_low" | "storage_unavailable" | "files_deleted" | "schedule_failed";
export type NotificationSeverity = "warning" | "error";

export interface NotificationRecord {
  id: string;
  type: NotificationType;
  sourceKey: string;
  deviceId: string | null;
  title: string;
  message: string;
  severity: NotificationSeverity;
  createdAt: string;
  readAt: string | null;
  resolvedAt: string | null;
}

interface NotificationRow {
  id: string;
  type: NotificationType;
  source_key: string;
  device_id: string | null;
  title: string;
  message: string;
  severity: NotificationSeverity;
  created_at: string;
  read_at: string | null;
  resolved_at: string | null;
}

function toApi(row: NotificationRow): NotificationRecord {
  return {
    id: row.id,
    type: row.type,
    sourceKey: row.source_key,
    deviceId: row.device_id,
    title: row.title,
    message: row.message,
    severity: row.severity,
    createdAt: row.created_at,
    readAt: row.read_at,
    resolvedAt: row.resolved_at,
  };
}

export function createNotification(input: {
  type: NotificationType;
  sourceKey: string;
  deviceId?: string | null;
  title: string;
  message: string;
  severity: NotificationSeverity;
}): NotificationRecord | null {
  const existing = db.prepare(`
    SELECT * FROM notifications WHERE type = ? AND source_key = ? AND resolved_at IS NULL
    ORDER BY created_at DESC LIMIT 1
  `).get(input.type, input.sourceKey) as NotificationRow | undefined;
  if (existing) return null;

  const now = new Date().toISOString();
  const row: NotificationRow = {
    id: randomUUID(),
    type: input.type,
    source_key: input.sourceKey,
    device_id: input.deviceId ?? null,
    title: input.title,
    message: input.message,
    severity: input.severity,
    created_at: now,
    read_at: null,
    resolved_at: null,
  };
  db.prepare(`
    INSERT INTO notifications (id, type, source_key, device_id, title, message, severity, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(row.id, row.type, row.source_key, row.device_id, row.title, row.message, row.severity, row.created_at);
  const notification = toApi(row);
  eventBus.publish("notification.created", notification);
  return notification;
}

export function resolveNotification(type: NotificationType, sourceKey: string): void {
  const result = db.prepare(`
    UPDATE notifications SET resolved_at = ?
    WHERE type = ? AND source_key = ? AND resolved_at IS NULL
  `).run(new Date().toISOString(), type, sourceKey);
  if (result.changes > 0) eventBus.publish("notification.updated", { type, sourceKey, resolved: true });
}

export function listNotifications(options: { includeResolved: boolean; limit: number; deviceId?: string; unassigned?: boolean }): NotificationRecord[] {
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (!options.includeResolved) clauses.push("resolved_at IS NULL");
  if (options.deviceId) {
    clauses.push("device_id = ?");
    values.push(options.deviceId);
  } else if (options.unassigned) {
    clauses.push("device_id IS NULL");
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.prepare(`
    SELECT * FROM notifications
    ${where}
    ORDER BY (read_at IS NULL) DESC, created_at DESC
    LIMIT ?
  `).all(...values, options.limit) as NotificationRow[];
  return rows.map(toApi);
}

export function countUnreadNotifications(): number {
  return (db.prepare("SELECT COUNT(*) AS count FROM notifications WHERE read_at IS NULL AND resolved_at IS NULL").get() as { count: number }).count;
}

export function markNotificationRead(id: string): NotificationRecord {
  db.prepare("UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ?")
    .run(new Date().toISOString(), id);
  const row = assertFound(
    db.prepare("SELECT * FROM notifications WHERE id = ?").get(id) as NotificationRow | undefined,
    "Notification not found",
  );
  const notification = toApi(row);
  eventBus.publish("notification.updated", notification);
  return notification;
}

export function markAllNotificationsRead(): number {
  const result = db.prepare("UPDATE notifications SET read_at = ? WHERE read_at IS NULL AND resolved_at IS NULL")
    .run(new Date().toISOString());
  eventBus.publish("notification.updated", { readAll: true });
  return result.changes;
}

export function deleteNotification(id: string): void {
  assertFound(db.prepare("SELECT id FROM notifications WHERE id = ?").get(id) as { id: string } | undefined, "Notification not found");
  db.prepare("DELETE FROM notifications WHERE id = ?").run(id);
  eventBus.publish("notification.deleted", { id });
}

export function deleteAllNotifications(): number {
  const result = db.prepare("DELETE FROM notifications").run();
  eventBus.publish("notification.deleted", { all: true });
  return Number(result.changes);
}

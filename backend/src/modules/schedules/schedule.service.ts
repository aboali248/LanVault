import { randomUUID } from "node:crypto";
import { db } from "../../database/connection";
import { queueGroupBackups, createBackupJob } from "../backups/backup.service";
import { AppError, assertFound } from "../../utils/errors";
import { parseJson } from "../../utils/json";
import { eventBus } from "../../services/event-bus";
import { createNotification } from "../../services/notification.service";
import { getSettings, updateSettings } from "../settings/settings.service";

export type ScheduleFrequency = "daily" | "weekly";
export type ScheduleTargetType = "device" | "group";
export type ScheduleMode = "full" | "incremental";

export interface ScheduleInput {
  name: string;
  targetType: ScheduleTargetType;
  targetId: string;
  frequency: ScheduleFrequency;
  dayOfWeek: number | null;
  timeOfDay: string;
  mode: ScheduleMode;
  retentionCount: number | null;
  enabled: boolean;
  windowStart: string | null;
  windowEnd: string | null;
  repeatIntervalMinutes: number | null;
}

interface ScheduleRow {
  id: string;
  name: string;
  target_type: ScheduleTargetType;
  target_id: string;
  frequency: ScheduleFrequency;
  day_of_week: number | null;
  time_of_day: string;
  mode: ScheduleMode;
  retention_count: number | null;
  enabled: number;
  window_start: string | null;
  window_end: string | null;
  repeat_interval_minutes: number | null;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

function toApi(row: ScheduleRow, now = new Date()) {
  return {
    id: row.id,
    name: row.name,
    targetType: row.target_type,
    targetId: row.target_id,
    frequency: row.frequency,
    dayOfWeek: row.day_of_week,
    timeOfDay: row.time_of_day,
    mode: row.mode,
    retentionCount: row.retention_count,
    enabled: Boolean(row.enabled),
    windowStart: row.window_start,
    windowEnd: row.window_end,
    repeatIntervalMinutes: row.repeat_interval_minutes,
    lastRunAt: row.last_run_at,
    nextRunAt: computeNextRun(row, now),
    lastRun: findLastScheduledRun(row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function atTime(date: Date, timeOfDay: string): Date {
  const [hours, minutes] = timeOfDay.split(":").map(Number);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes, 0, 0);
}

function isDueDay(row: Pick<ScheduleRow, "frequency" | "day_of_week">, date: Date): boolean {
  return row.frequency === "daily" || row.day_of_week === date.getDay();
}

function computeNextRun(row: Pick<ScheduleRow,
  "frequency" | "day_of_week" | "time_of_day" | "enabled" |
  "window_start" | "window_end" | "repeat_interval_minutes" | "last_run_at"
>, now: Date): string | null {
  if (!row.enabled) return null;
  if (row.repeat_interval_minutes !== null && row.window_start !== null && row.window_end !== null) {
    const intervalMs = row.repeat_interval_minutes * 60_000;
    const lastRunMs = row.last_run_at ? Date.parse(row.last_run_at) : NaN;
    for (let offset = 0; offset < 8; offset++) {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
      if (!isDueDay(row, date)) continue;
      const windowStart = atTime(date, row.window_start);
      const windowEnd = atTime(date, row.window_end);
      let candidate = offset === 0 ? new Date(Math.max(now.getTime(), windowStart.getTime())) : windowStart;
      if (offset === 0 && Number.isFinite(lastRunMs) && toDayKey(new Date(lastRunMs)) === toDayKey(date)) {
        candidate = new Date(Math.max(candidate.getTime(), lastRunMs + intervalMs));
      }
      if (candidate < windowEnd) return candidate.toISOString();
    }
    return null;
  }
  for (let offset = 0; offset < 8; offset++) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    if (!isDueDay(row, date)) continue;
    const candidate = atTime(date, row.time_of_day);
    if (candidate > now) return candidate.toISOString();
  }
  return null;
}

function findLastScheduledRun(scheduleId: string): {
  backupId: string; status: string; requestedAt: string;
} | null {
  const row = db.prepare(`
    SELECT id, status, requested_at FROM backups
    WHERE requested_by = ? ORDER BY requested_at DESC LIMIT 1
  `).get(`schedule:${scheduleId}`) as { id: string; status: string; requested_at: string } | undefined;
  return row ? { backupId: row.id, status: row.status, requestedAt: row.requested_at } : null;
}

function readSchedule(id: string) {
  return toApi(assertFound(
    db.prepare("SELECT * FROM backup_schedules WHERE id = ?").get(id) as ScheduleRow | undefined,
    "Backup schedule not found",
  ));
}

function validateTarget(input: Pick<ScheduleInput, "targetType" | "targetId">) {
  const table = input.targetType === "device" ? "devices" : "groups";
  assertFound(db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(input.targetId) as { id: string } | undefined, `${input.targetType} not found`);
}

const timeOfDayPattern = /^([01]\d|2[0-3]):[0-5]\d$/;

function validateTiming(input: Pick<ScheduleInput, "frequency" | "dayOfWeek" | "timeOfDay" | "windowStart" | "windowEnd" | "repeatIntervalMinutes">) {
  if (!timeOfDayPattern.test(input.timeOfDay)) throw new AppError(400, "Start time must be HH:MM");
  const hasWindow = input.windowStart !== null || input.windowEnd !== null || input.repeatIntervalMinutes !== null;
  if (!hasWindow) return;
  if (input.windowStart === null || input.windowEnd === null || input.repeatIntervalMinutes === null) {
    throw new AppError(400, "A repeat window needs a start time, an end time, and a repeat interval");
  }
  if (!timeOfDayPattern.test(input.windowStart) || !timeOfDayPattern.test(input.windowEnd)) {
    throw new AppError(400, "Repeat window times must be HH:MM");
  }
  if (input.windowStart >= input.windowEnd) {
    throw new AppError(400, "Repeat window end must be after its start");
  }
  if (!Number.isInteger(input.repeatIntervalMinutes) || input.repeatIntervalMinutes < 5 || input.repeatIntervalMinutes > 1440) {
    throw new AppError(400, "Repeat interval must be between 5 and 1440 minutes");
  }
}

export function listSchedules() {
  return (db.prepare("SELECT * FROM backup_schedules ORDER BY time_of_day, name COLLATE NOCASE").all() as ScheduleRow[]).map((row) => toApi(row));
}

export function createSchedule(input: ScheduleInput) {
  validateTarget(input);
  validateTiming(input);
  if (input.frequency === "daily" && input.dayOfWeek !== null) {
    throw new AppError(400, "Daily schedules cannot have a weekday selected");
  }
  if (input.frequency === "weekly" && input.dayOfWeek === null) {
    throw new AppError(400, "Weekly schedules require a weekday");
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO backup_schedules (id, name, target_type, target_id, frequency, day_of_week, time_of_day, mode, retention_count, enabled, window_start, window_end, repeat_interval_minutes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.name, input.targetType, input.targetId, input.frequency, input.dayOfWeek, input.timeOfDay, input.mode, input.retentionCount, input.enabled ? 1 : 0, input.windowStart, input.windowEnd, input.repeatIntervalMinutes, now, now);
  const schedule = readSchedule(id);
  eventBus.publish("schedule.created", schedule);
  return schedule;
}

export function updateSchedule(id: string, input: ScheduleInput) {
  validateTarget(input);
  validateTiming(input);
  if (input.frequency === "daily" && input.dayOfWeek !== null) {
    throw new AppError(400, "Daily schedules cannot have a weekday selected");
  }
  if (input.frequency === "weekly" && input.dayOfWeek === null) {
    throw new AppError(400, "Weekly schedules require a weekday");
  }
  const current = readSchedule(id);
  db.prepare(`
    UPDATE backup_schedules SET name = ?, target_type = ?, target_id = ?, frequency = ?, day_of_week = ?,
      time_of_day = ?, mode = ?, retention_count = ?, enabled = ?,
      window_start = ?, window_end = ?, repeat_interval_minutes = ?, updated_at = ? WHERE id = ?
  `).run(input.name, input.targetType, input.targetId, input.frequency, input.dayOfWeek, input.timeOfDay, input.mode, input.retentionCount, input.enabled ? 1 : 0, input.windowStart, input.windowEnd, input.repeatIntervalMinutes, new Date().toISOString(), id);
  const schedule = readSchedule(id);
  eventBus.publish("schedule.updated", { ...schedule, previous: current });
  return schedule;
}

export function deleteSchedule(id: string): void {
  readSchedule(id);
  db.prepare("DELETE FROM backup_schedules WHERE id = ?").run(id);
  eventBus.publish("schedule.deleted", { id });
}

export function runDueSchedules(now = new Date()): number {
  const minute = now.toTimeString().slice(0, 5);
  const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const weekday = now.getDay();
  const enabled = db.prepare(`
    SELECT * FROM backup_schedules
    WHERE enabled = 1
    ORDER BY created_at
  `).all() as ScheduleRow[];
  let queuedCount = 0;
  for (const row of enabled) {
    const dayDue = row.frequency === "daily" || row.day_of_week === weekday;
    if (!dayDue) continue;
    if (row.repeat_interval_minutes !== null) {
      if (row.window_start === null || row.window_end === null) continue;
      if (minute < row.window_start || minute >= row.window_end) continue;
      if (row.last_run_at) {
        const elapsedMinutes = (now.getTime() - Date.parse(row.last_run_at)) / 60_000;
        if (Number.isFinite(elapsedMinutes) && elapsedMinutes < row.repeat_interval_minutes) continue;
      }
    } else {
      if (row.time_of_day !== minute) continue;
      if (row.last_run_at && row.last_run_at.slice(0, 10) === dateKey) continue;
    }
    const target = { targetType: row.target_type, targetId: row.target_id };
    db.prepare("UPDATE backup_schedules SET last_run_at = ?, updated_at = ? WHERE id = ?")
      .run(now.toISOString(), now.toISOString(), row.id);
    try {
      if (target.targetType === "device") {
        createBackupJob({ deviceId: target.targetId, mode: row.mode, retentionCount: row.retention_count, requestedBy: `schedule:${row.id}` });
      } else {
        const result = queueGroupBackups(target.targetId, row.mode, `schedule:${row.id}`, row.retention_count);
        if (!result.queued.length) {
          throw new AppError(422, result.skipped.map((item) => item.reason).join("; ") || "No group devices could be scheduled");
        }
      }
      queuedCount += 1;
      eventBus.publish("schedule.ran", { scheduleId: row.id, ranAt: now.toISOString() });
      resolveScheduleFailures(row.id);
    } catch (error) {
      console.error(`Backup schedule ${row.id} failed`, error);
      notifyScheduleFailure(
        { id: row.id, name: row.name, deviceId: target.targetType === "device" ? target.targetId : null },
        error,
        now,
      );
    }
  }
  return queuedCount;
}

function notifyScheduleFailure(row: { id: string; name: string; deviceId?: string | null }, error: unknown, now: Date): void {
  try {
    const prefix = `schedule-fail:${row.id}:`;
    const pending = db.prepare(`
      SELECT id FROM notifications
      WHERE type = 'schedule_failed' AND source_key LIKE ? AND resolved_at IS NULL
      LIMIT 1
    `).get(`${prefix}%`) as { id: string } | undefined;
    if (pending) return;
    const dateKey = toDayKey(now);
    createNotification({
      type: "schedule_failed",
      sourceKey: `${prefix}${dateKey}`,
      deviceId: row.deviceId ?? null,
      title: `Scheduled backup failed: ${row.name}`,
      message: error instanceof Error ? error.message : "The scheduled backup could not be queued.",
      severity: "warning",
    });
  } catch (notificationError) {
    console.error(`Could not record schedule failure for ${row.id}`, notificationError);
  }
}

export function resolveScheduleFailures(scheduleId: string): void {
  try {
    const result = db.prepare(`
      UPDATE notifications SET resolved_at = ?
      WHERE type = 'schedule_failed' AND source_key LIKE ? AND resolved_at IS NULL
    `).run(new Date().toISOString(), `schedule-fail:${scheduleId}:%`);
    if (result.changes > 0) {
      eventBus.publish("notification.updated", { type: "schedule_failed", sourceKey: scheduleId, resolved: true });
    }
  } catch (error) {
    console.error(`Could not resolve schedule failures for ${scheduleId}`, error);
  }
}

export function runDueContinuousBackups(now = new Date()): number {  const globalInterval = getSettings().backup.continuousBackupIntervalMinutes;
  const devices = db.prepare(`
    SELECT d.id, d.backup_interval_minutes, d.continuous_backup_next_run_at,
      (SELECT b.status FROM backups b WHERE b.device_id = d.id ORDER BY b.requested_at DESC, b.created_at DESC LIMIT 1) AS latest_status,
      (SELECT b.completed_at FROM backups b WHERE b.device_id = d.id ORDER BY b.requested_at DESC, b.created_at DESC LIMIT 1) AS latest_completed_at,
      (SELECT b.updated_at FROM backups b WHERE b.device_id = d.id ORDER BY b.requested_at DESC, b.created_at DESC LIMIT 1) AS latest_updated_at,
      (SELECT b.requested_at FROM backups b WHERE b.device_id = d.id ORDER BY b.requested_at DESC, b.created_at DESC LIMIT 1) AS latest_requested_at
    FROM devices d
    WHERE d.continuous_backup_enabled = 1 AND d.approval_status = 'approved'
      AND NOT EXISTS (
        SELECT 1 FROM backups active
        WHERE active.device_id = d.id AND active.status IN ('queued', 'running', 'cancel_requested')
      )
    ORDER BY d.computer_name COLLATE NOCASE
  `).all() as Array<{
    id: string;
    backup_interval_minutes: number | null;
    continuous_backup_next_run_at: string | null;
    latest_status: string | null;
    latest_completed_at: string | null;
    latest_updated_at: string | null;
    latest_requested_at: string | null;
  }>;
  let queuedCount = 0;
  for (const device of devices) {
    // يفضل النسخ المستمر شغال بعد انتهاء أي نسخة (ناجحة أو فاشلة أو ملغاة)
    // حتى تلتقط التعديلات تلقائياً. لا نتوقف عند الفشل.
    if (!device.latest_status || !["completed", "failed", "cancelled"].includes(device.latest_status)) continue;
    const baseTime = device.latest_completed_at ?? device.latest_updated_at ?? device.latest_requested_at;
    if (!baseTime) continue;
    const interval = device.backup_interval_minutes ?? globalInterval;
    const intervalMs = interval * 60_000;
    const regularDueAt = Date.parse(baseTime) + intervalMs;
    const retryDueAt = device.continuous_backup_next_run_at
      ? Date.parse(device.continuous_backup_next_run_at)
      : regularDueAt;
    const dueAt = Math.max(regularDueAt, retryDueAt);
    if (!Number.isFinite(dueAt) || now.getTime() < dueAt) continue;

    const retryAt = new Date(now.getTime() + intervalMs).toISOString();
    db.prepare(`
      UPDATE devices SET continuous_backup_next_run_at = ?, updated_at = ?
      WHERE id = ? AND continuous_backup_enabled = 1
    `).run(retryAt, now.toISOString(), device.id);
    try {
      createBackupJob({
        deviceId: device.id,
        mode: "incremental",
        requestedBy: "continuous",
        continuousRun: true,
      });
      queuedCount += 1;
    } catch (error) {
      console.warn(`Continuous backup for device ${device.id} could not be queued`, error);
    }
  }
  return queuedCount;
}

const AUTO_SCHEDULE_ID = "auto";

export function getAutoScheduleStatus(now = new Date()): {
  config: {
    enabled: boolean;
    timeOfDay: string;
    frequency: "daily" | "weekly";
    dayOfWeek: number | null;
    mode: "full" | "incremental";
    retentionCount: number | null;
    lastRunAt: string | null;
  };
  nextRunAt: string | null;
  lastRun: { backupId: string; status: string; requestedAt: string } | null;
} {
  const auto = getSettings().backup.autoSchedule;
  const row = {
    frequency: auto.frequency,
    day_of_week: auto.dayOfWeek,
    time_of_day: auto.timeOfDay,
    enabled: auto.enabled ? 1 : 0,
    window_start: null,
    window_end: null,
    repeat_interval_minutes: null,
    last_run_at: auto.lastRunAt,
  };
  const lastRun = db.prepare(`
    SELECT id, status, requested_at FROM backups
    WHERE requested_by = 'auto-schedule' ORDER BY requested_at DESC LIMIT 1
  `).get() as { id: string; status: string; requested_at: string } | undefined;
  return {
    config: { ...auto },
    nextRunAt: computeNextRun(row, now),
    lastRun: lastRun ? { backupId: lastRun.id, status: lastRun.status, requestedAt: lastRun.requested_at } : null,
  };
}

export function runDueAutoSchedule(now = new Date()): number {  const auto = getSettings().backup.autoSchedule;
  if (!auto.enabled) return 0;
  const minute = now.toTimeString().slice(0, 5);
  const dateKey = toDayKey(now);
  if (!(auto.frequency === "daily" || auto.dayOfWeek === now.getDay())) return 0;
  if (auto.timeOfDay !== minute) return 0;
  if (auto.lastRunAt && auto.lastRunAt.slice(0, 10) === dateKey) return 0;

  updateSettings({
    backup: { autoSchedule: { ...auto, lastRunAt: now.toISOString() } },
  });
  const name = "Automatic schedule (all devices)";
  try {
    const devices = db.prepare(`
      SELECT id FROM devices WHERE approval_status = 'approved' ORDER BY computer_name COLLATE NOCASE
    `).all() as Array<{ id: string }>;
    let queued = 0;
    const skipped: string[] = [];
    for (const device of devices) {
      try {
        createBackupJob({
          deviceId: device.id,
          mode: auto.mode,
          retentionCount: auto.retentionCount,
          requestedBy: "auto-schedule",
        });
        queued += 1;
      } catch (error) {
        skipped.push(error instanceof Error ? error.message : "Unable to queue backup");
      }
    }
    if (!queued) {
      throw new AppError(422, skipped.join("; ") || "No devices are ready for automatic backup");
    }
    if (skipped.length) {
      console.warn(`Automatic schedule skipped ${skipped.length} device(s): ${skipped.join("; ")}`);
    }
    eventBus.publish("schedule.ran", { scheduleId: AUTO_SCHEDULE_ID, ranAt: now.toISOString() });
    resolveScheduleFailures(AUTO_SCHEDULE_ID);
    return 1;
  } catch (error) {
    console.error("Automatic schedule failed", error);
    notifyScheduleFailure({ id: AUTO_SCHEDULE_ID, name }, error, now);
    return 0;
  }
}

export interface GroupBackupWindow {
  start: string;
  end: string;
  days: number[];
  lastRunAt: string | null;
}

export function readGroupBackupWindow(backupConfig: unknown): GroupBackupWindow | null {
  if (typeof backupConfig !== "object" || backupConfig === null) return null;
  const record = backupConfig as Record<string, unknown>;
  const window = record.backupWindow;
  if (typeof window !== "object" || window === null) return null;
  const entry = window as Record<string, unknown>;
  if (typeof entry.start !== "string" || !timeOfDayPattern.test(entry.start)) return null;
  if (typeof entry.end !== "string" || !timeOfDayPattern.test(entry.end)) return null;
  if (entry.start >= entry.end) return null;
  if (!Array.isArray(entry.days)) return null;
  const days = [...new Set(entry.days.filter((day): day is number =>
    Number.isInteger(day) && (day as number) >= 0 && (day as number) <= 6))].sort();
  if (!days.length) return null;
  return {
    start: entry.start,
    end: entry.end,
    days,
    lastRunAt: typeof entry.lastRunAt === "string" && entry.lastRunAt ? entry.lastRunAt : null,
  };
}

export function computeGroupWindowNextRun(window: GroupBackupWindow | null, now = new Date()): string | null {
  if (!window) return null;
  for (let offset = 0; offset < 8; offset++) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    if (!window.days.includes(date.getDay())) continue;
    const candidate = atTime(date, window.start);
    if (candidate > now) return candidate.toISOString();
  }
  return null;
}

export function runDueGroupBackupWindows(now = new Date()): number {
  const minute = now.toTimeString().slice(0, 5);
  const dateKey = toDayKey(now);
  const weekday = now.getDay();
  const groups = db.prepare("SELECT id, name, backup_config FROM groups").all() as Array<{
    id: string; name: string; backup_config: string | null;
  }>;
  let fired = 0;
  for (const group of groups) {
    const window = readGroupBackupWindow(parseJson(group.backup_config, null));
    if (!window || !window.days.includes(weekday)) continue;
    if (minute < window.start || minute >= window.end) continue;
    if (window.lastRunAt && window.lastRunAt.slice(0, 10) === dateKey) continue;
    persistGroupWindowRun(group.id, group.backup_config, now);
    const label = `group-window:${group.id}`;
    try {
      const config = parseJson<Record<string, unknown>>(group.backup_config, {});
      const retention = Number.isInteger(config.retentionCount) ? Number(config.retentionCount) : null;
      const result = queueGroupBackups(group.id, "incremental", "group-window", retention);
      if (!result.queued.length) {
        throw new AppError(422, result.skipped.map((item) => item.reason).join("; ") || "No group devices could be scheduled");
      }
      fired += 1;
      eventBus.publish("schedule.ran", { scheduleId: label, ranAt: now.toISOString() });
      resolveScheduleFailures(label);
    } catch (error) {
      console.error(`Group backup window ${group.id} failed`, error);
      notifyScheduleFailure({ id: label, name: group.name }, error, now);
    }
  }
  return fired;
}

function persistGroupWindowRun(groupId: string, rawConfig: string | null, now: Date): void {
  try {
    const config = parseJson<Record<string, unknown>>(rawConfig, {});
    const window = (config.backupWindow ?? {}) as Record<string, unknown>;
    db.prepare("UPDATE groups SET backup_config = ?, updated_at = ? WHERE id = ?").run(
      JSON.stringify({ ...config, backupWindow: { ...window, lastRunAt: now.toISOString() } }),
      now.toISOString(),
      groupId,
    );
  } catch (error) {
    console.error(`Could not record group window run for ${groupId}`, error);
  }
}

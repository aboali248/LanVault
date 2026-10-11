import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../database/connection";
import { eventBus } from "../../services/event-bus";
import { asyncHandler, AppError, assertFound } from "../../utils/errors";
import { parseJson } from "../../utils/json";
import { pageResponse, parsePagination } from "../../utils/pagination";
import { queueGroupBackups } from "../backups/backup.service";
import { getDevice, updateDevice } from "../devices/device.service";
import { computeGroupWindowNextRun, readGroupBackupWindow } from "../schedules/schedule.service";

const idParams = z.object({ id: z.string().uuid() });
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const groupInput = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional().nullable(),
  backupConfig: z.object({
    retentionCount: z.number().int().min(1).max(1000).optional(),
    maxTransferMbps: z.number().positive().max(100000).nullable().optional(),
    defaultBackupType: z.enum(["full", "incremental"]).optional(),
    backupWindow: z.object({
      start: timeOfDay,
      end: timeOfDay,
      days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
      lastRunAt: z.string().datetime({ offset: true }).nullable().optional(),
    }).strict().refine((window) => window.start < window.end, "Window end must be after its start").optional().nullable(),
  }).strict().optional().nullable(),
}).strict();
const deviceList = z.object({ deviceIds: z.array(z.string().uuid()).max(500) }).strict();
const backupRequest = z.object({ mode: z.enum(["full", "incremental"]).default("incremental") }).strict();

export const groupRouter = Router();

function readGroup(id: string) {
  const row = assertFound(db.prepare(`
    SELECT g.*, COUNT(d.id) AS device_count
    FROM groups g LEFT JOIN devices d ON d.group_id = g.id
    WHERE g.id = ? GROUP BY g.id
  `).get(id) as Record<string, unknown> | undefined, "Group not found");
  const devices = db.prepare("SELECT id FROM devices WHERE group_id = ? ORDER BY computer_name")
    .all(id) as Array<{ id: string }>;
  const backupConfig = parseJson(row.backup_config as string | null, null);
  const backupWindow = readGroupBackupWindow(backupConfig);
  return {
    id: String(row.id),
    name: String(row.name),
    description: row.description as string | null,
    backupConfig,
    nextAutoRunAt: computeGroupWindowNextRun(backupWindow),
    deviceCount: Number(row.device_count),
    deviceIds: devices.map((device) => device.id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

groupRouter.get("/", asyncHandler((request, response) => {
  const pagination = parsePagination(request);
  const total = (db.prepare("SELECT COUNT(*) AS count FROM groups").get() as { count: number }).count;
  const ids = db.prepare("SELECT id FROM groups ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?")
    .all(pagination.pageSize, pagination.offset) as Array<{ id: string }>;
  response.json(pageResponse(ids.map(({ id }) => readGroup(id)), total, pagination));
}));

groupRouter.post("/", asyncHandler((request, response) => {
  const input = groupInput.parse(request.body);
  const id = randomUUID();
  const now = new Date().toISOString();
  try {
    db.prepare("INSERT INTO groups (id, name, description, backup_config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, input.name, input.description ?? null, input.backupConfig ? JSON.stringify(input.backupConfig) : null, now, now);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) throw new AppError(409, "A group with that name already exists");
    throw error;
  }
  const group = readGroup(id);
  eventBus.publish("group.created", group);
  response.status(201).json({ data: group });
}));

groupRouter.get("/:id", asyncHandler((request, response) => {
  response.json({ data: readGroup(idParams.parse(request.params).id) });
}));

groupRouter.put("/:id", asyncHandler((request, response) => {
  const { id } = idParams.parse(request.params);
  const input = groupInput.parse(request.body);
  assertFound(db.prepare("SELECT id FROM groups WHERE id = ?").get(id) as { id: string } | undefined, "Group not found");
  try {
    db.prepare("UPDATE groups SET name = ?, description = ?, backup_config = ?, updated_at = ? WHERE id = ?")
      .run(input.name, input.description ?? null, input.backupConfig ? JSON.stringify(input.backupConfig) : null, new Date().toISOString(), id);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) throw new AppError(409, "A group with that name already exists");
    throw error;
  }
  const group = readGroup(id);
  eventBus.publish("group.updated", group);
  response.json({ data: group });
}));

groupRouter.delete("/:id", asyncHandler((request, response) => {
  const { id } = idParams.parse(request.params);
  assertFound(db.prepare("SELECT id FROM groups WHERE id = ?").get(id) as { id: string } | undefined, "Group not found");
  db.prepare("DELETE FROM groups WHERE id = ?").run(id);
  eventBus.publish("group.deleted", { id });
  response.status(204).send();
}));

groupRouter.put("/:id/devices", asyncHandler((request, response) => {
  const { id } = idParams.parse(request.params);
  const { deviceIds } = deviceList.parse(request.body);
  assertFound(db.prepare("SELECT id FROM groups WHERE id = ?").get(id) as { id: string } | undefined, "Group not found");
  const move = db.transaction(() => {
    const current = db.prepare("SELECT id FROM devices WHERE group_id = ?").all(id) as Array<{ id: string }>;
    const requested = new Set(deviceIds);
    for (const device of current) {
      if (!requested.has(device.id)) updateDevice(device.id, { groupId: null });
    }
    for (const deviceId of deviceIds) {
      assertFound(db.prepare("SELECT id FROM devices WHERE id = ?").get(deviceId) as { id: string } | undefined, `Device ${deviceId} not found`);
      updateDevice(deviceId, { groupId: id });
    }
  });
  move();
  const group = readGroup(id);
  eventBus.publish("group.updated", group);
  response.json({ data: group });
}));

groupRouter.post("/:id/backups", asyncHandler((request, response) => {
  const { id } = idParams.parse(request.params);
  const { mode } = backupRequest.parse(request.body ?? {});
  const result = queueGroupBackups(id, mode, null, null, false);
  response.status(202).json({ data: result });
}));

groupRouter.put("/:id/devices/continuous", asyncHandler((request, response) => {
  const { id } = idParams.parse(request.params);
  const { enabled } = z.object({ enabled: z.boolean() }).strict().parse(request.body);
  assertFound(db.prepare("SELECT id FROM groups WHERE id = ?").get(id) as { id: string } | undefined, "Group not found");
  const now = new Date().toISOString();
  const result = db.prepare(`
    UPDATE devices SET continuous_backup_enabled = ?, backup_interval_minutes = NULL,
      continuous_backup_next_run_at = NULL, updated_at = ? WHERE group_id = ?
  `).run(enabled ? 1 : 0, now, id);
  eventBus.publish("group.updated", readGroup(id));
  response.json({ data: { updated: result.changes } });
}));

groupRouter.get("/:id/devices", asyncHandler((request, response) => {
  const { id } = idParams.parse(request.params);
  const pagination = parsePagination(request);
  assertFound(db.prepare("SELECT id FROM groups WHERE id = ?").get(id) as { id: string } | undefined, "Group not found");
  const rows = db.prepare("SELECT id FROM devices WHERE group_id = ? ORDER BY computer_name LIMIT ? OFFSET ?")
    .all(id, pagination.pageSize, pagination.offset) as Array<{ id: string }>;
  const total = (db.prepare("SELECT COUNT(*) AS count FROM devices WHERE group_id = ?").get(id) as { count: number }).count;
  response.json(pageResponse(rows.map((row) => getDevice(row.id)), total, pagination));
}));

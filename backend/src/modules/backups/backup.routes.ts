import { Router } from "express";
import { z } from "zod";
import { eventBus } from "../../services/event-bus";
import { asyncHandler } from "../../utils/errors";
import { pageResponse, parsePagination } from "../../utils/pagination";
import { clearBackupLogs, createBackupJob, deleteAllBackups, deleteBackup, getBackup, getBackupLogs, listBackupRows, listLatestBackupRows, requestStopBackup } from "./backup.service";

const createSchema = z.object({
  deviceId: z.string().uuid(),
  mode: z.enum(["full", "incremental"]),
}).strict();
const idSchema = z.object({ id: z.string().uuid() });
const querySchema = z.object({
  deviceId: z.string().uuid().optional(),
  status: z.enum(["queued", "running", "completed", "failed", "cancel_requested", "cancelled"]).optional(),
  mode: z.enum(["full", "incremental"]).optional(),
}).passthrough();

export const backupRouter = Router();

backupRouter.get("/", asyncHandler((request, response) => {
  const filters = querySchema.parse(request.query);
  const pagination = parsePagination(request);
  const result = listBackupRows({ ...filters, limit: pagination.pageSize, offset: pagination.offset });
  response.json(pageResponse(result.rows, result.total, pagination));
}));

backupRouter.post("/", asyncHandler((request, response) => {
  const input = createSchema.parse(request.body);
  const backup = createBackupJob({ deviceId: input.deviceId, mode: input.mode });
  response.status(202).json({ data: backup });
}));

backupRouter.get("/latest", asyncHandler((request, response) => {
  const pagination = parsePagination(request);
  const result = listLatestBackupRows({ limit: pagination.pageSize, offset: pagination.offset });
  response.json(pageResponse(result.rows, result.total, pagination));
}));

backupRouter.get("/:id", asyncHandler((request, response) => {
  response.json({ data: getBackup(idSchema.parse(request.params).id) });
}));

backupRouter.post("/:id/stop", asyncHandler((request, response) => {
  const backup = requestStopBackup(idSchema.parse(request.params).id);
  response.json({ data: backup });
}));

backupRouter.get("/:id/logs", asyncHandler((request, response) => {
  const { id } = idSchema.parse(request.params);
  const pagination = parsePagination(request, 100);
  const result = getBackupLogs(id, pagination.pageSize, pagination.offset);
  response.json(pageResponse(result.items, result.total, pagination));
}));

backupRouter.delete("/:id/logs", asyncHandler((request, response) => {
  const result = clearBackupLogs(idSchema.parse(request.params).id);
  response.json({ data: result });
}));

backupRouter.delete("/:id", asyncHandler((request, response) => {
  const result = deleteBackup(idSchema.parse(request.params).id);
  response.json({ data: result });
}));

backupRouter.delete("/", asyncHandler((_request, response) => {
  response.json({ data: deleteAllBackups() });
}));

import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/errors";
import { pageResponse, parsePagination } from "../../utils/pagination";
import {
  createDevice,
  deleteDevice,
  getDevice,
  listDevices,
  listDisks,
  queueAllDeviceAgentUpdates,
  queueDeviceAgentUpdate,
  setApproval,
  setDeviceBackupExclusions,
  setDeviceContinuousBackup,
  setDeviceArchive,
  setDiskSelection,
  updateDevice,
} from "./device.service";
import { eventBus } from "../../services/event-bus";
import { fileExtensionsSchema } from "../backups/file-exclusions";

const idParams = z.object({ id: z.string().uuid() });
const nullableText = z.string().trim().min(1).max(255).nullable().optional();
const macAddress = z.string().trim().regex(/^([0-9a-f]{2}[:-]){5}([0-9a-f]{2})$/i, "Invalid MAC address").optional().nullable();
const diskInput = z.object({
  id: z.string().trim().min(1).max(255),
  name: z.string().trim().min(1).max(255),
  letter: z.string().trim().max(16).nullable().optional(),
  fileSystem: z.string().trim().max(64).nullable().optional(),
  totalBytes: z.number().int().nonnegative().safe().nullable().optional(),
  freeBytes: z.number().int().nonnegative().safe().nullable().optional(),
}).strict();

const createDeviceSchema = z.object({
  computerName: z.string().trim().min(1).max(255),
  windowsUsername: nullableText,
  ipAddress: nullableText,
  macAddress,
  operatingSystem: nullableText,
  groupId: z.string().uuid().nullable().optional(),
  disks: z.array(diskInput).max(64).optional(),
}).strict();

const updateDeviceSchema = createDeviceSchema.omit({ disks: true }).partial().refine((body) => Object.keys(body).length > 0, "At least one field is required");
const diskSelectionSchema = z.object({
  disks: z.array(z.object({ id: z.string().uuid(), isSelected: z.boolean() }).strict()).min(1).max(64),
}).strict();
const backupExclusionsSchema = z.object({
  excludedExtensions: fileExtensionsSchema,
  includedExtensions: fileExtensionsSchema,
}).strict();
const continuousBackupSchema = z.object({
  enabled: z.boolean(),
  intervalMinutes: z.number().int().min(1).max(1440).nullable(),
}).strict();
const archiveSchema = z.object({
  mode: z.enum(["off", "zip"]),
  password: z.string().max(256).nullable().optional(),
}).strict();

const listQuery = z.object({
  search: z.string().trim().max(255).optional(),
  approvalStatus: z.enum(["pending", "approved", "rejected"]).optional(),
  status: z.enum(["online", "offline", "busy", "error"]).optional(),
  groupId: z.string().uuid().optional(),
}).passthrough();

export const deviceRouter = Router();

deviceRouter.get("/", asyncHandler((request, response) => {
  const filters = listQuery.parse(request.query);
  const pagination = parsePagination(request);
  const result = listDevices({ ...filters, limit: pagination.pageSize, offset: pagination.offset });
  response.json(pageResponse(result.rows, result.total, pagination));
}));

// Discovery is intentionally agent-driven: only self-registered LAN agents are returned.
deviceRouter.get("/discovery", asyncHandler((request, response) => {
  const pagination = parsePagination(request);
  const result = listDevices({ approvalStatus: "pending", limit: pagination.pageSize, offset: pagination.offset });
  response.json({ ...pageResponse(result.rows, result.total, pagination), source: "agent_registration" });
}));

deviceRouter.post("/discover", asyncHandler((request, response) => {
  const pagination = parsePagination(request);
  const result = listDevices({ approvalStatus: "pending", limit: pagination.pageSize, offset: pagination.offset });
  response.json({ ...pageResponse(result.rows, result.total, pagination), source: "agent_registration" });
}));

deviceRouter.post("/", asyncHandler((request, response) => {
  const body = createDeviceSchema.parse(request.body);
  const device = createDevice(body);
  eventBus.publish("device.created", device);
  response.status(201).json({ data: device });
}));

deviceRouter.get("/:id", asyncHandler((request, response) => {
  const { id } = idParams.parse(request.params);
  response.json({ data: getDevice(id) });
}));

deviceRouter.post("/update-agents", asyncHandler((_request, response) => {
  const result = queueAllDeviceAgentUpdates();
  for (const deviceId of result.queued) {
    try {
      eventBus.publish("device.updated", getDevice(deviceId, false));
    } catch {
      // A single realtime failure must not fail the bulk update.
    }
  }
  response.status(202).json({ data: result });
}));

deviceRouter.post("/:id/update-agent", asyncHandler((request, response) => {
  const { id } = idParams.parse(request.params);
  const result = queueDeviceAgentUpdate(id);
  if (result.alreadyQueued) {
    response.status(202).json({ data: { queued: true, alreadyQueued: true } });
    return;
  }
  eventBus.publish("device.updated", getDevice(id, false));
  response.status(202).json({ data: { queued: true, alreadyQueued: false } });
}));

deviceRouter.patch("/:id", asyncHandler((request, response) => {
  const { id } = idParams.parse(request.params);
  const device = updateDevice(id, updateDeviceSchema.parse(request.body));
  eventBus.publish("device.updated", device);
  response.json({ data: device });
}));

deviceRouter.delete("/:id", asyncHandler((request, response) => {
  const { id } = idParams.parse(request.params);
  deleteDevice(id);
  eventBus.publish("device.deleted", { id });
  response.status(204).send();
}));

deviceRouter.post("/:id/approve", asyncHandler((request, response) => {
  const { id } = idParams.parse(request.params);
  const device = setApproval(id, "approved");
  eventBus.publish("device.updated", device);
  response.json({ data: device });
}));

deviceRouter.post("/:id/reject", asyncHandler((request, response) => {
  const { id } = idParams.parse(request.params);
  const device = setApproval(id, "rejected");
  eventBus.publish("device.updated", device);
  response.json({ data: device });
}));

deviceRouter.post("/:id/unapprove", asyncHandler((request, response) => {
  const { id } = idParams.parse(request.params);
  const device = setApproval(id, "pending");
  eventBus.publish("device.updated", device);
  response.json({ data: device });
}));

deviceRouter.get("/:id/disks", asyncHandler((request, response) => {
  const { id } = idParams.parse(request.params);
  response.json({ data: listDisks(id) });
}));

deviceRouter.put("/:id/disks", asyncHandler((request, response) => {
  const { id } = idParams.parse(request.params);
  const { disks } = diskSelectionSchema.parse(request.body);
  const updated = setDiskSelection(id, disks);
  const device = getDevice(id);
  eventBus.publish("device.updated", device);
  response.json({ data: updated });
}));

deviceRouter.put("/:id/backup-exclusions", asyncHandler((request, response) => {
  const { id } = idParams.parse(request.params);
  const exclusions = backupExclusionsSchema.parse(request.body);
  const device = setDeviceBackupExclusions(id, exclusions);
  eventBus.publish("device.updated", device);
  response.json({ data: device });
}));

deviceRouter.put("/:id/continuous-backup", asyncHandler((request, response) => {
  const { id } = idParams.parse(request.params);
  const settings = continuousBackupSchema.parse(request.body);
  const device = setDeviceContinuousBackup(id, settings);
  eventBus.publish("device.updated", device);
  response.json({ data: device });
}));

deviceRouter.put("/:id/archive", asyncHandler((request, response) => {
  const { id } = idParams.parse(request.params);
  const archive = archiveSchema.parse(request.body);
  const device = setDeviceArchive(id, archive);
  eventBus.publish("device.updated", device);
  response.json({ data: device });
}));

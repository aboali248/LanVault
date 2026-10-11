import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/errors";
import { getSettings, updateSettings } from "./settings.service";
import { getAutoScheduleStatus } from "../schedules/schedule.service";
import { getReplicationStatus } from "../backups/replication.service";
import { browseStorageDirectories, testStorageDestinations } from "./storage.service";
import { fileExtensionsSchema } from "../backups/file-exclusions";

const settingsSchema = z.object({
  server: z.object({ host: z.string().trim().min(1).max(255), port: z.number().int().min(1).max(65535) }).strict().optional(),
  network: z.object({ advertisedAddress: z.string().trim().max(255).nullable() }).strict().optional(),
  backup: z.object({
    destination: z.string().trim().max(1024).nullable(),
    secondaryDestination: z.string().trim().max(1024).nullable().optional(),
    maxTransferRateMbps: z.number().positive().max(100000).nullable(),
    retentionCount: z.number().int().min(1).max(1000).nullable(),
    lowSpaceThresholdPercent: z.number().int().min(1).max(50).optional(),
    excludedExtensions: fileExtensionsSchema.optional(),
    continuousBackupIntervalMinutes: z.number().int().min(1).max(1440).optional(),
    autoSchedule: z.object({
      enabled: z.boolean(),
      timeOfDay: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      frequency: z.enum(["daily", "weekly"]),
      dayOfWeek: z.number().int().min(0).max(6).nullable(),
      mode: z.enum(["full", "incremental"]),
      retentionCount: z.number().int().min(1).max(1000).nullable(),
      lastRunAt: z.string().datetime({ offset: true }).nullable(),
    }).strict().optional(),
  }).strict().optional(),
  agent: z.object({ heartbeatTimeoutSeconds: z.number().int().min(5).max(3600) }).strict().optional(),
  interface: z.object({ language: z.enum(["ar", "en"]), theme: z.enum(["light", "dark", "system"]) }).strict().optional(),
}).strict();
const storageCheckSchema = z.object({
  backup: settingsSchema.shape.backup.unwrap(),
}).strict();

export const settingsRouter = Router();
settingsRouter.get("/", (_request, response) => response.json({ data: getSettings() }));
settingsRouter.get("/auto-schedule", (_request, response) => response.json({ data: getAutoScheduleStatus() }));
settingsRouter.get("/replication", (_request, response) => response.json({ data: getReplicationStatus() }));
settingsRouter.get("/storage-browse", asyncHandler((request, response) => {
  const query = z.object({ path: z.string().trim().min(1).max(1024).optional() }).strict().parse(request.query);
  const target = query.path ?? getSettings().backup.destination ?? undefined;
  response.json({ data: browseStorageDirectories(target) });
}));
settingsRouter.post("/storage-check", asyncHandler((request, response) => {
  const { backup } = storageCheckSchema.parse(request.body);
  response.json({ data: testStorageDestinations({ ...getSettings().backup, ...backup }) });
}));
settingsRouter.put("/", asyncHandler((request, response) => {
  response.json({ data: updateSettings(settingsSchema.parse(request.body)) });
}));

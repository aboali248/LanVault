import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/errors";
import { createSchedule, deleteSchedule, listSchedules, updateSchedule } from "./schedule.service";

export const scheduleRouter = Router();

const inputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  targetType: z.enum(["device", "group"]),
  targetId: z.string().uuid(),
  frequency: z.enum(["daily", "weekly"]),
  dayOfWeek: z.number().int().min(0).max(6).nullable(),
  timeOfDay: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  mode: z.enum(["full", "incremental"]),
  retentionCount: z.number().int().min(1).max(1000).nullable(),
  enabled: z.boolean(),
  windowStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  windowEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  repeatIntervalMinutes: z.number().int().min(5).max(1440).nullable(),
}).strict();

scheduleRouter.get("/", (_request, response) => response.json({ data: listSchedules() }));
scheduleRouter.post("/", asyncHandler((request, response) => {
  response.status(201).json({ data: createSchedule(inputSchema.parse(request.body)) });
}));
scheduleRouter.put("/:id", asyncHandler((request, response) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  response.json({ data: updateSchedule(id, inputSchema.parse(request.body)) });
}));
scheduleRouter.delete("/:id", asyncHandler((request, response) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  deleteSchedule(id);
  response.status(204).send();
}));

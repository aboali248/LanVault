import { Router } from "express";
import { z } from "zod";
import { asyncHandler, assertFound } from "../../utils/errors";
import { db } from "../../database/connection";
import { countUnreadNotifications, deleteAllNotifications, deleteNotification, listNotifications, markAllNotificationsRead, markNotificationRead } from "../../services/notification.service";

export const notificationRouter = Router();

notificationRouter.get("/", (request, response) => {
  const query = z.object({
    includeResolved: z.enum(["true", "false"]).default("false"),
    limit: z.coerce.number().int().min(1).max(200).default(100),
    deviceId: z.string().uuid().optional(),
    unassigned: z.enum(["true", "false"]).default("false"),
  }).parse(request.query);
  response.json({ data: { items: listNotifications({ includeResolved: query.includeResolved === "true", limit: query.limit, deviceId: query.deviceId, unassigned: query.unassigned === "true" }), unread: countUnreadNotifications() } });
});

notificationRouter.delete("/", (request, response) => {
  response.json({ data: { deleted: deleteAllNotifications() } });
});

notificationRouter.post("/read-all", (_request, response) => {
  response.json({ data: { updated: markAllNotificationsRead() } });
});

notificationRouter.post("/:id/read", asyncHandler((request, response) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  assertFound(db.prepare("SELECT id FROM notifications WHERE id = ?").get(id) as { id: string } | undefined, "Notification not found");
  response.json({ data: markNotificationRead(id) });
}));

notificationRouter.delete("/:id", asyncHandler((request, response) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  deleteNotification(id);
  response.status(204).send();
}));

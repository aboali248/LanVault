import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import path from "node:path";
import { config } from "./config";
import { acquireServerLock } from "./services/server-lock";
import { authRouter } from "./modules/auth/auth.routes";
import { requireAdmin } from "./modules/auth/auth.service";
import { db } from "./database/connection";
import { runMigrations } from "./database/migrate";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";
import { backupRouter } from "./modules/backups/backup.routes";
import { deviceBackupRouter } from "./modules/devices/device.backup.routes";
import { deviceRouter } from "./modules/devices/device.routes";
import { agentRouter, legacyAgentInstallerRouter } from "./modules/agents/agent.routes";
import { groupRouter } from "./modules/groups/group.routes";
import { settingsRouter } from "./modules/settings/settings.routes";
import { scheduleRouter } from "./modules/schedules/schedule.routes";
import { notificationRouter } from "./modules/notifications/notification.routes";
import { getDashboardSummary } from "./services/dashboard.service";
import { startPresenceMonitor } from "./services/presence.service";
import { attachWebSocketServer } from "./services/websocket";
import { getSettings } from "./modules/settings/settings.service";
import { asyncHandler } from "./utils/errors";
import { runDueContinuousBackups, runDueGroupBackupWindows } from "./modules/schedules/schedule.service";
import { runReplicationQueue } from "./modules/backups/replication.service";
runMigrations(db);
const releaseServerLock = acquireServerLock(path.dirname(config.databasePath));

const app = express();
app.disable("x-powered-by");
app.use(cors({ origin: config.corsOrigins.includes("*") ? true : config.corsOrigins }));
app.use(express.json({ limit: "1mb", strict: true }));
app.get("/health", (_request, response) => response.json({ status: "ok", checkedAt: new Date().toISOString() }));
app.use("/api/v1/auth", authRouter);
app.get("/api/v1/dashboard", requireAdmin, asyncHandler((_request, response) => response.json({ data: getDashboardSummary() })));
app.use("/api/v1/devices", requireAdmin, deviceRouter);
app.use("/api/v1/devices", requireAdmin, deviceBackupRouter);
app.use("/api/v1/backups", requireAdmin, backupRouter);
app.use("/api/v1/groups", requireAdmin, groupRouter);
app.use("/api/v1/settings", requireAdmin, settingsRouter);
app.use("/api/v1/schedules", requireAdmin, scheduleRouter);
app.use("/api/v1/notifications", requireAdmin, notificationRouter);
app.use("/api/v1/agents", agentRouter);
app.use("/api/agent/v1", legacyAgentInstallerRouter);
app.use(notFoundHandler);
app.use(errorHandler);

const server = createServer(app);
server.requestTimeout = 30 * 60 * 1000;
attachWebSocketServer(server);
const stopPresenceMonitor = startPresenceMonitor();
const scheduleTimer = setInterval(() => {
  // Timing hub: department windows drive automatic backups; the per-device
  // continuous switch (toggled from the device card or its department) is
  // the only other automatic control. Other runners stay unscheduled.
  runDueGroupBackupWindows();
  runDueContinuousBackups();
  // Secondary storage catches up here: content uploaded once (primary) is
  // copied to the secondary destination without using the LAN again.
  void runReplicationQueue();
}, 15_000);
scheduleTimer.unref();
const serverSettings = getSettings().server;
server.listen(serverSettings.port, serverSettings.host, () => {
  console.info(`LanVault API listening on http://${serverSettings.host}:${serverSettings.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopPresenceMonitor();
    clearInterval(scheduleTimer);
    server.close(() => {
      releaseServerLock();
      db.close();
      process.exit(0);
    });
  });
}

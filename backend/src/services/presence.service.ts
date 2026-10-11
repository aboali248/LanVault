import { db } from "../database/connection";
import { eventBus } from "./event-bus";
import { getDevice } from "../modules/devices/device.service";
import { getSettings } from "../modules/settings/settings.service";
import { createNotification, resolveNotification } from "./notification.service";
import { inspectConfiguredStorage } from "../modules/settings/storage.service";

export function markStaleAgentsOffline(): number {
  const threshold = new Date(Date.now() - getSettings().agent.heartbeatTimeoutSeconds * 1_000).toISOString();
  const stale = db.prepare(`
    SELECT id, computer_name, last_seen_at FROM devices
    WHERE last_seen_at IS NOT NULL
      AND last_seen_at < ?
      AND (status != 'offline' OR agent_status != 'offline')
  `).all(threshold) as Array<{ id: string; computer_name: string; last_seen_at: string | null }>;
  const interruptedUpdates = db.prepare(`
    SELECT id FROM devices
    WHERE last_seen_at IS NOT NULL
      AND last_seen_at < ?
      AND agent_update_status IN ('queued', 'downloading', 'installing')
  `).all(threshold) as Array<{ id: string }>;
  if (!stale.length && !interruptedUpdates.length) return 0;
  const now = new Date().toISOString();
  const markOffline = db.prepare("UPDATE devices SET status = 'offline', agent_status = 'offline', updated_at = ? WHERE id = ?");
  const markUpdateFailed = db.prepare(`
    UPDATE devices
    SET agent_update_status = 'failed',
        agent_update_error = 'Agent went offline during the update. Reconnect the device and retry.',
        updated_at = ?
    WHERE id = ? AND agent_update_status IN ('queued', 'downloading', 'installing')
  `);
  const completeUpdateCommands = db.prepare(`
    UPDATE agent_commands SET status = 'completed', completed_at = ?
    WHERE device_id = ? AND type = 'update_agent'
      AND status IN ('pending', 'delivered', 'acknowledged')
  `);
  db.transaction(() => {
    for (const device of stale) markOffline.run(now, device.id);
    for (const device of interruptedUpdates) {
      if (markUpdateFailed.run(now, device.id).changes > 0) completeUpdateCommands.run(now, device.id);
    }
  })();
  for (const device of stale) {
    eventBus.publish("device.status", getDevice(device.id, false));
    createNotification({
      type: "agent_offline",
      sourceKey: device.id,
      deviceId: device.id,
      title: `Agent offline: ${device.computer_name}`,
      message: `No heartbeat received for more than ${getSettings().agent.heartbeatTimeoutSeconds} seconds. Last seen: ${device.last_seen_at ?? "unknown"}.`,
      severity: "warning",
    });
  }
  for (const device of interruptedUpdates) {
    eventBus.publish("device.updated", getDevice(device.id, false));
  }
  return stale.length;
}

export function startPresenceMonitor(): () => void {
  let lastStorageCheck = 0;
  const timer = setInterval(() => {
    markStaleAgentsOffline();
    if (Date.now() - lastStorageCheck >= 60_000) {
      inspectConfiguredStorage(getSettings().backup);
      lastStorageCheck = Date.now();
    }
  }, 15_000);
  timer.unref();
  return () => clearInterval(timer);
}

import "dotenv/config";
import { randomBytes } from "node:crypto";
import path from "node:path";

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const cwd = process.cwd();
const configuredBackupDestination = process.env.BACKUP_DESTINATION?.trim();
const defaultBackupDestination = process.platform === "win32" ? "E:\\LanVault-Backup" : null;

export const config = {
  port: positiveInteger(process.env.PORT, 3031),
  host: process.env.HOST?.trim() || "0.0.0.0",
  databasePath: path.resolve(cwd, process.env.DATABASE_PATH?.trim() || "./data/lanvault.db"),
  corsOrigins: (process.env.CORS_ORIGINS ?? "*")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  backupDestination: configuredBackupDestination === "E:" || configuredBackupDestination === "E:\\"
    ? defaultBackupDestination
    : configuredBackupDestination || defaultBackupDestination,
  agentBootstrapToken: process.env.AGENT_BOOTSTRAP_TOKEN?.trim() || null,
  adminPassword: process.env.AUTH_ADMIN_PASSWORD ?? "1",
  userPassword: process.env.AUTH_USER_PASSWORD ?? "1",
  authTokenSecret: process.env.AUTH_TOKEN_SECRET?.trim() || randomBytes(32).toString("hex"),
  agentHeartbeatTimeoutSeconds: positiveInteger(process.env.AGENT_HEARTBEAT_TIMEOUT_SECONDS, 90),
  backupTickMs: positiveInteger(process.env.BACKUP_TICK_MS, 15_000),
} as const;

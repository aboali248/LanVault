import { db } from "../../database/connection";
import { config } from "../../config";
import { parseJson } from "../../utils/json";
import { normalizeFileExtensions } from "../backups/file-exclusions";

export interface AutoScheduleConfig {
  enabled: boolean;
  timeOfDay: string;
  frequency: "daily" | "weekly";
  dayOfWeek: number | null;
  mode: "full" | "incremental";
  retentionCount: number | null;
  lastRunAt: string | null;
}

export interface SettingsDocument {
  server: {
    host: string;
    port: number;
  };
  network: {
    advertisedAddress: string | null;
  };
  backup: {
    destination: string | null;
    secondaryDestination: string | null;
    maxTransferRateMbps: number | null;
    retentionCount: number | null;
    lowSpaceThresholdPercent: number;
    excludedExtensions: string[];
    continuousBackupIntervalMinutes: number;
    autoSchedule: AutoScheduleConfig;
  };
  agent: {
    heartbeatTimeoutSeconds: number;
  };
  interface: {
    language: "ar" | "en";
    theme: "light" | "dark" | "system";
  };
}

const defaults: SettingsDocument = {
  server: { host: config.host, port: config.port },
  network: { advertisedAddress: null },
  backup: {
    destination: config.backupDestination,
    secondaryDestination: null,
    maxTransferRateMbps: null,
    retentionCount: null,
    lowSpaceThresholdPercent: 10,
    excludedExtensions: [],
    continuousBackupIntervalMinutes: 5,
    autoSchedule: {
      enabled: false,
      timeOfDay: "02:00",
      frequency: "daily",
      dayOfWeek: null,
      mode: "incremental",
      retentionCount: null,
      lastRunAt: null,
    },
  },
  agent: { heartbeatTimeoutSeconds: config.agentHeartbeatTimeoutSeconds },
  interface: { language: "ar", theme: "system" },
};

type StoredSettings = Record<keyof SettingsDocument, unknown>;

export function getSettings(): SettingsDocument {
  const rows = db.prepare("SELECT key, value FROM settings").all() as Array<{ key: string; value: string }>;
  const stored = rows.reduce<Record<string, unknown>>((result, row) => {
    result[row.key] = parseJson(row.value, null);
    return result;
  }, {});

  const savedBackup = isObject(stored.backup) ? stored.backup : {};
  const savedDestination = savedBackup.destination;
  const migratedDestination = process.platform === "win32" &&
    (savedDestination === "E:" || savedDestination === "E:\\" || savedDestination === "")
    ? "E:\\LanVault-Backup"
    : savedDestination;

  return {
    server: { ...defaults.server, ...(isObject(stored.server) ? stored.server : {}) },
    network: { ...defaults.network },
    backup: {
      ...defaults.backup,
      ...savedBackup,
      destination: typeof migratedDestination === "string" ? migratedDestination : defaults.backup.destination,
      excludedExtensions: normalizeFileExtensions(savedBackup.excludedExtensions),
      continuousBackupIntervalMinutes: Number.isInteger(savedBackup.continuousBackupIntervalMinutes) &&
        Number(savedBackup.continuousBackupIntervalMinutes) >= 1 &&
        Number(savedBackup.continuousBackupIntervalMinutes) <= 1440
        ? Number(savedBackup.continuousBackupIntervalMinutes)
        : defaults.backup.continuousBackupIntervalMinutes,
      autoSchedule: normalizeAutoSchedule(isObject(savedBackup.autoSchedule) ? savedBackup.autoSchedule : null),
    },
    agent: { ...defaults.agent, ...(isObject(stored.agent) ? stored.agent : {}) },
    interface: { ...defaults.interface, ...(isObject(stored.interface) ? stored.interface : {}) },
  } as SettingsDocument;
}

const timeOfDayPattern = /^([01]\d|2[0-3]):[0-5]\d$/;

function normalizeAutoSchedule(saved: Record<string, unknown> | null): AutoScheduleConfig {
  const fallback = defaults.backup.autoSchedule;
  if (!saved) return { ...fallback };
  const timeOfDay = typeof saved.timeOfDay === "string" && timeOfDayPattern.test(saved.timeOfDay)
    ? saved.timeOfDay
    : fallback.timeOfDay;
  const frequency = saved.frequency === "weekly" ? "weekly" : "daily";
  const dayOfWeek = Number.isInteger(saved.dayOfWeek) && Number(saved.dayOfWeek) >= 0 && Number(saved.dayOfWeek) <= 6
    ? Number(saved.dayOfWeek)
    : null;
  return {
    enabled: saved.enabled === true,
    timeOfDay,
    frequency,
    dayOfWeek: frequency === "weekly" ? dayOfWeek : null,
    mode: saved.mode === "full" ? "full" : "incremental",
    retentionCount: Number.isInteger(saved.retentionCount) && Number(saved.retentionCount) >= 1 && Number(saved.retentionCount) <= 1000
      ? Number(saved.retentionCount)
      : null,
    lastRunAt: typeof saved.lastRunAt === "string" && saved.lastRunAt ? saved.lastRunAt : null,
  };
}

export function updateSettings(patch: { [K in keyof SettingsDocument]?: Partial<SettingsDocument[K]> }): SettingsDocument {
  const current = getSettings();
  const next: SettingsDocument = {
    server: { ...current.server, ...(patch.server ?? {}) },
    network: { ...current.network, ...(patch.network ?? {}) },
    backup: { ...current.backup, ...(patch.backup ?? {}) },
    agent: { ...current.agent, ...(patch.agent ?? {}) },
    interface: { ...current.interface, ...(patch.interface ?? {}) },
  };
  const now = new Date().toISOString();
  const upsert = db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  db.transaction((value: SettingsDocument) => {
    for (const key of Object.keys(value) as Array<keyof SettingsDocument>) {
      upsert.run(key, JSON.stringify(value[key]), now);
    }
  })(next);
  return next;
}

export function getConfiguredBackupDestination(): string | null {
  return getSettings().backup.destination?.trim() || null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

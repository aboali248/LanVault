import fs from "node:fs";
import path from "node:path";
import { db } from "../../database/connection";
import { AppError, assertFound } from "../../utils/errors";
import type { BackupRow, DeviceRow, DiskRow } from "../../types/domain";
import { getConfiguredBackupDestination, getSettings } from "../settings/settings.service";

export interface BackupFileLocation {
  backupDirectory: string;
  driveDirectory: string;
  relativePath: string;
}

export type DestinationSlot = "primary" | "secondary";
export interface BackupFileMetadata {
  sizeBytes: number;
  lastWriteTicks: string;
  sha256: string;
}

export function prepareBackupDirectories(
  computerName: string,
  deviceId: string,
  disks: DiskRow[],
  destinations: Array<string | null>,
): void {
  for (const destination of new Set(destinations.map((item) => item?.trim()).filter((item): item is string => Boolean(item)))) {
    for (const disk of disks) {
      const drive = (disk.letter || disk.disk_key).trim().replace(/[\\/:]+$/, "");
      if (!/^[a-z]$/i.test(drive)) throw new AppError(422, "A selected disk does not have a supported drive letter");
      const machineDirectory = resolveMachineDirectory(destination, computerName, deviceId)
        ?? legacyMachineDirectory(destination, computerName, deviceId);
      const driveDirectory = path.join(machineDirectory, drive.toUpperCase());
      try {
        fs.mkdirSync(driveDirectory, { recursive: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown filesystem error";
        throw new AppError(422, `Cannot create backup directory '${driveDirectory}': ${message}`);
      }
    }
  }
}

export function backupFileLocation(deviceId: string, backupId: string, drive: string, relative: string, slot: DestinationSlot): BackupFileLocation {
  const backup = assertFound(
    db.prepare("SELECT * FROM backups WHERE id = ? AND device_id = ?").get(backupId, deviceId) as BackupRow | undefined,
    "Backup not found",
  );
  const device = assertFound(
    db.prepare("SELECT * FROM devices WHERE id = ?").get(deviceId) as DeviceRow | undefined,
    "Device not found",
  );
  const destination = slot === "secondary"
    ? getSettings().backup.secondaryDestination?.trim()
    : backup.destination?.trim() || getConfiguredBackupDestination();
  if (!destination) throw new AppError(422, "Configure a server backup destination before uploading files");
  if (!/^[a-z]$/i.test(drive)) throw new AppError(400, "Invalid source drive");

  const disks = JSON.parse(backup.disks_snapshot) as DiskRow[];
  const selectedDrive = disks.some((disk) => {
    const letter = (disk.letter || disk.disk_key).trim().replace(/[\\/:]+$/, "");
    return letter.localeCompare(`${drive}:`, undefined, { sensitivity: "accent" }) === 0 ||
      letter.localeCompare(drive, undefined, { sensitivity: "accent" }) === 0;
  });
  if (!selectedDrive) throw new AppError(400, "The uploaded file is not on a disk selected for this backup");

  const normalizedRelative = relative.replace(/[\\/]+/g, path.sep);
  const segments = normalizedRelative.split(path.sep);
  if (!relative.trim() || path.isAbsolute(normalizedRelative) ||
      path.win32.isAbsolute(relative) || segments.some((segment) => !segment || segment === "." || segment === "..") ||
      relative.includes("\0") || relative.includes(":")) {
    throw new AppError(400, "Invalid file path");
  }

  const backupDirectory = resolveMachineDirectory(destination, device.computer_name, deviceId)
    ?? legacyMachineDirectory(destination, device.computer_name, deviceId);
  const target = path.resolve(backupDirectory, drive.toUpperCase(), normalizedRelative);
  const fromBackup = path.relative(backupDirectory, target);
  if (fromBackup === ".." || fromBackup.startsWith(`..${path.sep}`) || path.isAbsolute(fromBackup)) {
    throw new AppError(400, "File path escapes the device directory");
  }
  return { backupDirectory, driveDirectory: drive.toUpperCase(), relativePath: normalizedRelative };
}

export function sanitize(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
}

const DEVICE_MARKER = ".lanvault-device-id";
const claimedMachineDirectories = new Set<string>();

function directoryExists(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function findDeviceFolder(base: string, deviceId: string): string | null {
  let entries;
  try {
    entries = fs.readdirSync(base, { withFileTypes: true });
  } catch {
    return null;
  }
  const suffix = `_${deviceId}`;
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.endsWith(suffix)) return path.join(base, entry.name);
  }
  return null;
}

function claimMachineDirectory(directory: string, deviceId: string): boolean {
  const claim = `${directory}::${deviceId}`;
  if (claimedMachineDirectories.has(claim)) return true;
  const marker = path.join(directory, DEVICE_MARKER);
  let owner: string | null = null;
  try {
    if (fs.existsSync(marker)) owner = fs.readFileSync(marker, "utf8").trim() || null;
  } catch {
    owner = null;
  }
  if (owner !== null && owner !== deviceId) return false;
  try {
    fs.writeFileSync(marker, deviceId, "utf8");
  } catch {
    // A missing marker never blocks backups; ownership is best effort.
  }
  claimedMachineDirectories.add(claim);
  return true;
}

export function legacyMachineDirectory(destination: string, computerName: string, deviceId: string): string {
  return path.join(path.resolve(destination), `${sanitize(computerName)}_${deviceId}`);
}

/**
 * Device folders are named after the computer only (e.g. `DESKTOP-ABC`).
 * A legacy `<name>_<device-id>` folder is renamed in place on first use, and a
 * name already owned by another device falls back to the legacy unique name.
 */
export function resolveMachineDirectory(
  destination: string,
  computerName: string,
  deviceId: string,
  ensure = true,
): string | null {
  const base = path.resolve(destination);
  const primary = path.join(base, sanitize(computerName));
  if (!directoryExists(primary)) {
    const legacy = legacyMachineDirectory(destination, computerName, deviceId);
    const candidate = directoryExists(legacy) ? legacy : findDeviceFolder(base, deviceId);
    if (candidate) {
      try {
        fs.mkdirSync(base, { recursive: true });
        fs.renameSync(candidate, primary);
      } catch {
        // Fall through; callers surface IO errors as before.
      }
    }
  }
  if (!directoryExists(primary)) {
    if (!ensure) return null;
    try {
      fs.mkdirSync(primary, { recursive: true });
    } catch {
      // Fall through; callers surface IO errors as before.
    }
    if (!directoryExists(primary)) return primary;
  }
  if (claimMachineDirectory(primary, deviceId)) return primary;
  const fallback = legacyMachineDirectory(destination, computerName, deviceId);
  if (!directoryExists(fallback)) {
    if (!ensure) return null;
    try {
      fs.mkdirSync(fallback, { recursive: true });
    } catch {
      // Fall through; callers surface IO errors as before.
    }
  }
  claimMachineDirectory(fallback, deviceId);
  return fallback;
}

export function resolveFile(location: BackupFileLocation): string {
  return path.join(location.backupDirectory, location.driveDirectory, location.relativePath);
}

export function resolveExistingBackupFile(location: BackupFileLocation, backupId: string): string {
  const legacyPath = path.join(location.backupDirectory, backupId, location.driveDirectory, location.relativePath);
  return fs.existsSync(legacyPath) ? legacyPath : resolveFile(location);
}

export function assertBackupBelongsToDevice(deviceId: string, backupId: string): void {
  assertFound(db.prepare("SELECT id FROM backups WHERE id = ? AND device_id = ?")
    .get(backupId, deviceId) as { id: string } | undefined, "Backup not found");
}

export function normalizePrefix(prefix?: string): string {
  const rawPrefix = (prefix ?? "").replace(/[\\/]+/g, "/").replace(/^\/+|\/+$/g, "");
  if (rawPrefix.includes("..") || rawPrefix.includes("\0") || rawPrefix.includes(":")) {
    throw new AppError(400, "Invalid folder path");
  }
  return rawPrefix ? `${rawPrefix}/` : "";
}

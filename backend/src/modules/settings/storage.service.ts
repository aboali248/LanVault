import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createNotification, resolveNotification } from "../../services/notification.service";
import type { SettingsDocument } from "./settings.service";
import { AppError } from "../../utils/errors";

export interface DestinationStatus {
  path: string | null;
  configured: boolean;
  available: boolean;
  writable: boolean;
  totalBytes: number | null;
  freeBytes: number | null;
  freePercent: number | null;
  error: string | null;
}

export interface StorageBrowseResult {
  path: string | null;
  parentPath: string | null;
  roots: string[];
  directories: string[];
  hasMore: boolean;
}

export function browseStorageDirectories(requestedPath?: string): StorageBrowseResult {
  if (!requestedPath) {
    const roots = process.platform === "win32"
      ? Array.from({ length: 26 }, (_, index) => `${String.fromCharCode(65 + index)}:\\`)
        .filter((root) => fs.existsSync(root))
      : [path.parse(process.cwd()).root];
    return { path: null, parentPath: null, roots, directories: [], hasMore: false };
  }

  if (!path.isAbsolute(requestedPath)) {
    throw new AppError(400, "Browse path must be an absolute path");
  }

  const currentPath = path.resolve(requestedPath);
  try {
    if (!fs.statSync(currentPath).isDirectory()) {
      throw new AppError(400, "Browse path is not a directory");
    }
    const directories = fs.readdirSync(currentPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((first, second) => first.localeCompare(second, undefined, { sensitivity: "base" }));
    const limit = 500;
    const parentPath = path.dirname(currentPath) === currentPath ? null : path.dirname(currentPath);
    return {
      path: currentPath,
      parentPath,
      roots: [],
      directories: directories.slice(0, limit),
      hasMore: directories.length > limit,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {
        path: currentPath,
        parentPath: path.dirname(currentPath) === currentPath ? null : path.dirname(currentPath),
        roots: [],
        directories: [],
        hasMore: false,
      };
    }
    throw new AppError(400, `Cannot browse '${currentPath}': ${error instanceof Error ? error.message : "Access denied"}`);
  }
}

function inspectDestination(destination: string | null, verifyWrite: boolean): DestinationStatus {
  if (!destination?.trim()) {
    return { path: null, configured: false, available: false, writable: false, totalBytes: null, freeBytes: null, freePercent: null, error: null };
  }
  const resolved = path.resolve(destination.trim());
  try {
    if (verifyWrite) fs.mkdirSync(resolved, { recursive: true });
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      return { path: destination, configured: true, available: false, writable: false, totalBytes: null, freeBytes: null, freePercent: null, error: "Destination is not a directory" };
    }
    if (verifyWrite) {
      const probe = path.join(resolved, `.lanvault-write-check-${randomUUID()}.tmp`);
      try {
        fs.writeFileSync(probe, "LanVault storage permission check", { flag: "wx" });
      } finally {
        if (fs.existsSync(probe)) fs.unlinkSync(probe);
      }
    }
    let totalBytes: number | null = null;
    let freeBytes: number | null = null;
    try {
      const filesystem = fs.statfsSync(resolved);
      totalBytes = Number(filesystem.blocks) * Number(filesystem.bsize);
      freeBytes = Number(filesystem.bavail) * Number(filesystem.bsize);
    } catch {
      // Some Windows SMB providers do not expose filesystem capacity to Node.
    }
    return {
      path: destination,
      configured: true,
      available: true,
      writable: true,
      totalBytes,
      freeBytes,
      freePercent: totalBytes && freeBytes !== null ? (freeBytes / totalBytes) * 100 : null,
      error: null,
    };
  } catch (error) {
    return {
      path: destination,
      configured: true,
      available: false,
      writable: false,
      totalBytes: null,
      freeBytes: null,
      freePercent: null,
      error: error instanceof Error ? error.message : "Destination is unavailable",
    };
  }
}

export function testStorageDestinations(settings: SettingsDocument["backup"]) {
  return {
    primary: inspectDestination(settings.destination, true),
    secondary: inspectDestination(settings.secondaryDestination, true),
    checkedAt: new Date().toISOString(),
  };
}

export function inspectConfiguredStorage(settings: SettingsDocument["backup"]) {
  const primary = inspectDestination(settings.destination, false);
  const secondary = inspectDestination(settings.secondaryDestination, false);
  const threshold = settings.lowSpaceThresholdPercent;
  const destinations = [
    { key: "primary", label: "Primary backup storage", status: primary },
    { key: "secondary", label: "Secondary backup storage", status: secondary },
  ].filter((item) => item.status.configured);

  let hasFailure = false;
  for (const destination of destinations) {
    const sourceKey = destination.key;
    if (!destination.status.available || !destination.status.writable) {
      hasFailure = true;
      createNotification({
        type: "storage_unavailable",
        sourceKey,
        title: `${destination.label} unavailable`,
        message: destination.status.error ?? "The path cannot be accessed.",
        severity: "error",
      });
      continue;
    }
    resolveNotification("storage_unavailable", sourceKey);
    if (destination.status.freePercent !== null && destination.status.freePercent <= threshold) {
      hasFailure = true;
      createNotification({
        type: "storage_low",
        sourceKey,
        title: `${destination.label} is low on space`,
        message: `${destination.status.freePercent.toFixed(1)}% free; configured threshold is ${threshold}%.`,
        severity: "warning",
      });
    } else {
      resolveNotification("storage_low", sourceKey);
    }
  }
  return { primary, secondary, hasFailure };
}

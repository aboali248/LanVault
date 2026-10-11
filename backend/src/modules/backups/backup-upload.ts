import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { pipeline, finished } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { db } from "../../database/connection";
import { AppError, assertFound } from "../../utils/errors";
import {
  assertBackupBelongsToDevice,
  backupFileLocation,
  resolveExistingBackupFile,
  resolveFile,
  type BackupFileLocation,
  type BackupFileMetadata,
  type DestinationSlot,
} from "./backup-paths";
import { getDeviceArchive } from "../devices/device.service";
import { extractZipToTemp, writeFileZip, zipMatchesFile } from "./backup-zip";
import {
  chunkPathForDeviceDir,
  ensureBlob,
  expectedChunkCount,
  hashFile,
  linkOrCopy,
  matchesFile,
  removeUploadedChunks,
  resolveReadableBlob,
} from "./backup-content";

/**
 * Points the live mirror at retained content. Devices with archive mode
 * enabled get a password-protected (or plain) .zip instead of raw bytes;
 * stale counterparts from previous modes are removed best effort.
 */
async function placeMirror(
  location: BackupFileLocation,
  blobPath: string,
  target: string,
  relative: string,
  archive: { mode: "off" | "zip"; password: string | null },
): Promise<void> {
  if (archive.mode !== "zip") {
    linkOrCopy(blobPath, target);
    try {
      fs.rmSync(`${target}.zip`, { force: true });
    } catch {
      // Stale archives are harmless.
    }
    return;
  }
  const innerName = relative.split(/[\\/]/).pop() || "file";
  await writeFileZip(`${target}.zip`, blobPath, innerName, archive.password);
  try {
    fs.rmSync(target, { force: true });
  } catch {
    // Stale raw mirrors are harmless.
  }
}

export async function queryMissingChunks(  deviceId: string,
  backupId: string,
  drive: string,
  relative: string,
  slot: DestinationSlot,
  query: { sizeBytes: number; chunkSize: number; chunks: string[] },
): Promise<number[]> {
  const location = backupFileLocation(deviceId, backupId, drive, relative, slot);
  if (query.chunks.length !== expectedChunkCount(query.sizeBytes, query.chunkSize)) {
    throw new AppError(400, "Chunk list does not match the declared file size");
  }
  const missing: number[] = [];
  query.chunks.forEach((sha, index) => {
    if (!fs.existsSync(chunkPathForDeviceDir(location.backupDirectory, sha))) missing.push(index);
  });
  return missing;
}

export async function storeFileChunk(
  deviceId: string,
  backupId: string,
  drive: string,
  relative: string,
  slot: DestinationSlot,
  chunkIndex: number,
  sha256: string,
  input: Readable,
): Promise<void> {
  if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0) throw new AppError(400, "Invalid chunk index");
  const location = backupFileLocation(deviceId, backupId, drive, relative, slot);
  const target = chunkPathForDeviceDir(location.backupDirectory, sha256);
  if (fs.existsSync(target)) {
    try { input.resume(); } catch { /* Client already sent the bytes. */ }
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.upload`;
  try {
    await pipeline(input, createWriteStream(temporary, { flags: "wx" }));
    const actual = await hashFile(temporary);
    if (actual !== sha256.toLowerCase()) {
      throw new AppError(400, "Uploaded chunk does not match its declared checksum");
    }
    try {
      fs.renameSync(temporary, target);
    } catch {
      if (!fs.existsSync(target)) throw new AppError(500, "Could not retain the uploaded chunk");
      fs.rmSync(temporary, { force: true });
    }
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch { /* Preserve the original error. */ }
    throw error;
  }
}

export async function assembleFileChunks(
  deviceId: string,
  backupId: string,
  drive: string,
  relative: string,
  slot: DestinationSlot,
  metadata: BackupFileMetadata,
  chunkSize: number,
  chunkShas: string[],
): Promise<void> {
  const backup = assertFound(
    db.prepare("SELECT status FROM backups WHERE id = ? AND device_id = ?").get(backupId, deviceId) as { status: string } | undefined,
    "Backup not found",
  );
  if (["completed", "failed", "cancelled"].includes(backup.status)) throw new AppError(409, "This backup is already complete");
  if (chunkShas.length !== expectedChunkCount(metadata.sizeBytes, chunkSize)) {
    throw new AppError(400, "Chunk list does not match the declared file size");
  }
  const location = backupFileLocation(deviceId, backupId, drive, relative, slot);
  // Short circuit: the whole content is already retained (e.g. duplicate file).
  const alreadyRetained = resolveReadableBlob(location.backupDirectory, metadata.sha256);
  if (alreadyRetained) {
    try {
      const target = resolveFile(location);
      await placeMirror(location, alreadyRetained.path, target, relative, getDeviceArchive(deviceId));
    } finally {
      try {
        alreadyRetained.release();
      } catch {
        // Temporary cleanup is best effort.
      }
    }
    recordBackupFile(deviceId, backupId, drive, relative, metadata);
    removeUploadedChunks(location.backupDirectory, chunkShas);
    return;
  }
  const chunkPaths = chunkShas.map((sha) => chunkPathForDeviceDir(location.backupDirectory, sha));
  for (const chunkPath of chunkPaths) {
    if (!fs.existsSync(chunkPath)) throw new AppError(409, "Missing uploaded chunks for this file");
  }
  const target = resolveFile(location);
  const temporary = `${target}.${randomUUID()}.assemble`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    const output = createWriteStream(temporary, { flags: "wx" });
    try {
      for (const chunkPath of chunkPaths) {
        await pipeline(fs.createReadStream(chunkPath), output, { end: false });
      }
    } finally {
      output.end();
      await finished(output);
    }
    const stat = fs.statSync(temporary);
    if (stat.size !== metadata.sizeBytes) throw new AppError(400, "Assembled file size does not match");
    const actual = await hashFile(temporary);
    if (actual !== metadata.sha256.toLowerCase()) {
      throw new AppError(400, "Assembled file does not match its declared checksum");
    }
    const blob = ensureBlob(location.backupDirectory, temporary, actual);
    await placeMirror(location, blob, target, relative, getDeviceArchive(deviceId));
    try { fs.rmSync(temporary, { force: true }); } catch { /* Mirror now references retained content. */ }
    recordBackupFile(deviceId, backupId, drive, relative, metadata);
    removeUploadedChunks(location.backupDirectory, chunkShas);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch { /* Preserve the original error. */ }
    throw error;
  }
}

export async function writeBackupFile(
  deviceId: string,
  backupId: string,
  drive: string,
  relative: string,
  slot: DestinationSlot,
  metadata: BackupFileMetadata,
  input: Readable,
): Promise<void> {
  const backup = assertFound(
    db.prepare("SELECT status FROM backups WHERE id = ? AND device_id = ?").get(backupId, deviceId) as { status: string } | undefined,
    "Backup not found",
  );
  if (["completed", "failed", "cancelled"].includes(backup.status)) throw new AppError(409, "This backup is already complete");
  const location = backupFileLocation(deviceId, backupId, drive, relative, slot);
  const target = resolveFile(location);
  const temporary = `${target}.${randomUUID()}.upload`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    await pipeline(input, createWriteStream(temporary, { flags: "wx" }));
    const actualSha256 = await hashFile(temporary);
    if (actualSha256 !== metadata.sha256.toLowerCase()) {
      throw new AppError(400, "Uploaded file content does not match its declared checksum");
    }
    // Retain every version by content hash so any backup can be browsed
    // and restored later, then point the live mirror at that content.
    const blob = ensureBlob(location.backupDirectory, temporary, actualSha256);
    await placeMirror(location, blob, target, relative, getDeviceArchive(deviceId));
    try { fs.rmSync(temporary, { force: true }); } catch { /* Mirror now references retained content. */ }
    recordBackupFile(deviceId, backupId, drive, relative, metadata);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch { /* Preserve the original stream error. */ }
    throw error;
  }
}

export function cloneBackupFile(
  deviceId: string,
  targetBackupId: string,
  drive: string,
  relative: string,
  slot: DestinationSlot,
  metadata: BackupFileMetadata,
): Promise<boolean> {
  return cloneBackupFileAsync(deviceId, targetBackupId, drive, relative, slot, metadata);
}

async function cloneBackupFileAsync(
  deviceId: string,
  targetBackupId: string,
  drive: string,
  relative: string,
  slot: DestinationSlot,
  metadata: BackupFileMetadata,
): Promise<boolean> {
  const targetLocation = backupFileLocation(deviceId, targetBackupId, drive, relative, slot);
  const target = resolveFile(targetLocation);
  const archive = getDeviceArchive(deviceId);
  const archived = archive.mode === "zip";
  const mirrorMatches = archived
    ? fs.existsSync(`${target}.zip`) &&
      (await zipMatchesFile(`${target}.zip`, metadata.sizeBytes, metadata.sha256, archive.password))
    : await matchesFile(target, metadata);
  if (mirrorMatches) {
    try {
      if (archived) {
        const extracted = extractZipToTemp(`${target}.zip`, archive.password);
        try {
          ensureBlob(targetLocation.backupDirectory, extracted.path, metadata.sha256);
        } finally {
          try {
            extracted.release();
          } catch {
            // Temporary cleanup is best effort.
          }
        }
      } else {
        const blob = ensureBlob(targetLocation.backupDirectory, target, metadata.sha256);
        linkOrCopy(blob, target);
      }
    } catch { /* Mirror already holds the right content; version retention is best effort. */ }
    // Unchanged content: confirm current state without writing a duplicate history row.
    confirmUnchangedFile(deviceId, targetBackupId, drive, relative, metadata);
    return true;
  }

  // Content-addressed fast path: this exact version is already retained.
  // Cold (compressed) versions are materialized to a temp file first.
  const readable = resolveReadableBlob(targetLocation.backupDirectory, metadata.sha256);
  if (readable) {
    try {
      await placeMirror(targetLocation, readable.path, target, relative, archive);
    } finally {
      try {
        readable.release();
      } catch {
        // Temporary cleanup is best effort.
      }
    }
    recordBackupFile(deviceId, targetBackupId, drive, relative, metadata);
    return true;
  }

  const sourceFile = db.prepare(`
    SELECT backup_id FROM backup_files
    WHERE device_id = ? AND drive = ? AND relative_path = ? COLLATE NOCASE
      AND size_bytes = ? AND last_write_ticks = ? AND sha256 = ? AND backup_id != ?
    ORDER BY created_at DESC
  `).all(deviceId, drive.toUpperCase(), relative, metadata.sizeBytes, metadata.lastWriteTicks, metadata.sha256, targetBackupId) as Array<{ backup_id: string }>;
  let source: string | undefined;
  for (const { backup_id: sourceBackupId } of sourceFile) {
    const backup = db.prepare("SELECT status FROM backups WHERE id = ? AND device_id = ?")
      .get(sourceBackupId, deviceId) as { status: string } | undefined;
    if (!backup || !["completed", "cancelled", "failed"].includes(backup.status)) continue;
    const candidate = resolveExistingBackupFile(
      backupFileLocation(deviceId, sourceBackupId, drive, relative, slot),
      sourceBackupId,
    );
    if (candidate !== target && await matchesFile(candidate, metadata)) {
      source = candidate;
      break;
    }
  }
  if (!source) return false;

  const blob = ensureBlob(targetLocation.backupDirectory, source, metadata.sha256);
  await placeMirror(targetLocation, blob, target, relative, archive);
  recordBackupFile(deviceId, targetBackupId, drive, relative, metadata);
  return true;
}

export function recordBackupFile(
  deviceId: string,
  backupId: string,
  drive: string,
  relative: string,
  metadata: BackupFileMetadata,
): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO backup_files (backup_id, device_id, drive, relative_path, size_bytes, last_write_ticks, sha256, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(backup_id, drive, relative_path) DO UPDATE SET
      size_bytes = excluded.size_bytes,
      last_write_ticks = excluded.last_write_ticks,
      sha256 = excluded.sha256,
      created_at = excluded.created_at
  `).run(backupId, deviceId, drive.toUpperCase(), relative, metadata.sizeBytes, metadata.lastWriteTicks, metadata.sha256, now);
  db.prepare(`
    INSERT INTO file_current (device_id, drive, relative_path, backup_id, size_bytes, last_write_ticks, sha256, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(device_id, drive, relative_path) DO UPDATE SET
      backup_id = excluded.backup_id,
      size_bytes = excluded.size_bytes,
      last_write_ticks = excluded.last_write_ticks,
      sha256 = excluded.sha256,
      updated_at = excluded.updated_at
  `).run(deviceId, drive.toUpperCase(), relative, backupId, metadata.sizeBytes, metadata.lastWriteTicks, metadata.sha256, now);
}

export function confirmUnchangedFile(
  deviceId: string,
  backupId: string,
  drive: string,
  relative: string,
  metadata: BackupFileMetadata,
): void {
  assertBackupBelongsToDevice(deviceId, backupId);
  db.prepare(`
    INSERT INTO file_current (device_id, drive, relative_path, backup_id, size_bytes, last_write_ticks, sha256, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(device_id, drive, relative_path) DO UPDATE SET
      backup_id = excluded.backup_id,
      size_bytes = excluded.size_bytes,
      last_write_ticks = excluded.last_write_ticks,
      sha256 = excluded.sha256,
      updated_at = excluded.updated_at
  `).run(deviceId, drive.toUpperCase(), relative, backupId, metadata.sizeBytes, metadata.lastWriteTicks, metadata.sha256, new Date().toISOString());
}

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { AppError } from "../../utils/errors";
import type { BackupFileMetadata } from "./backup-paths";

const COMPRESSED_SUFFIX = ".gz";
const COLD_BLOB_MIN_AGE_MS = 60 * 60 * 1000;
const COLD_BLOB_MIN_SIZE = 4096;

function storeRootFor(deviceDir: string): string {
  return path.dirname(deviceDir);
}

export function blobPathForDeviceDir(deviceDir: string, sha256: string): string {
  return globalBlobPath(deviceDir, sha256);
}

function globalBlobPath(deviceDir: string, sha256: string): string {
  const normalized = sha256.toLowerCase();
  return path.join(storeRootFor(deviceDir), ".blobs", normalized.slice(0, 2), normalized);
}

function legacyBlobPath(deviceDir: string, sha256: string): string {
  const normalized = sha256.toLowerCase();
  return path.join(deviceDir, ".blobs", normalized.slice(0, 2), normalized);
}

/** Uncompressed global blob, legacy per-device blob, in that order. */
export function findRetainedBlob(deviceDir: string, sha256: string): string | null {
  const normalized = sha256.toLowerCase();
  const global = path.join(storeRootFor(deviceDir), ".blobs", normalized.slice(0, 2), normalized);
  if (fs.existsSync(global)) return global;
  const legacy = path.join(deviceDir, ".blobs", normalized.slice(0, 2), normalized);
  if (fs.existsSync(legacy)) return legacy;
  return null;
}

export interface ReadableBlob {
  path: string;
  release: () => void;
}

/**
 * Returns readable bytes for retained content, decompressing cold (.gz)
 * versions to a temporary file when needed. Callers must invoke release().
 */
export function resolveReadableBlob(deviceDir: string, sha256: string): ReadableBlob | null {
  const direct = findRetainedBlob(deviceDir, sha256);
  if (direct) return { path: direct, release: () => undefined };
  const normalized = sha256.toLowerCase();
  const candidates = [
    path.join(storeRootFor(deviceDir), ".blobs", normalized.slice(0, 2), `${normalized}${COMPRESSED_SUFFIX}`),
    path.join(deviceDir, ".blobs", normalized.slice(0, 2), `${normalized}${COMPRESSED_SUFFIX}`),
  ];
  for (const compressed of candidates) {
    if (!fs.existsSync(compressed)) continue;
    const temporary = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "lanvault-restore-")),
      normalized,
    );
    try {
      fs.writeFileSync(temporary, gunzipSync(fs.readFileSync(compressed)));
      return {
        path: temporary,
        release: () => {
          try {
            fs.rmSync(temporary, { force: true });
            fs.rmdirSync(path.dirname(temporary));
          } catch {
            // Temporary cleanup is best effort.
          }
        },
      };
    } catch {
      try {
        fs.rmSync(temporary, { force: true });
      } catch {
        // Ignore cleanup failures; the read below reports the real error.
      }
      throw new AppError(500, "The retained backup copy is damaged and cannot be read");
    }
  }
  return null;
}

export function linkOrCopy(source: string, target: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    if (fs.existsSync(target)) fs.rmSync(target, { force: true });
  } catch { /* Best effort; link/copy below will surface real errors. */ }
  try {
    fs.linkSync(source, target);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) ||
        !["EXDEV", "EPERM", "EACCES", "ENOTSUP", "EEXIST"].includes(String(error.code))) throw error;
    fs.copyFileSync(source, target);
  }
}

export async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex").toLowerCase();
}

export function ensureBlob(deviceDir: string, contentPath: string, sha256: string): string {
  const blob = globalBlobPath(deviceDir, sha256);
  if (!fs.existsSync(blob)) {
    fs.mkdirSync(path.dirname(blob), { recursive: true });
    const staging = `${blob}.${randomUUID()}.blob`;
    try {
      fs.copyFileSync(contentPath, staging);
      try {
        fs.renameSync(staging, blob);
      } catch {
        if (!fs.existsSync(blob)) throw new AppError(500, "Could not retain the uploaded file version");
        fs.rmSync(staging, { force: true });
      }
    } catch (error) {
      try { fs.rmSync(staging, { force: true }); } catch { /* Preserve the original error. */ }
      throw error;
    }
  }
  return blob;
}

export function chunkPathForDeviceDir(deviceDir: string, sha256: string): string {
  const normalized = sha256.toLowerCase();
  return path.join(deviceDir, ".chunks", normalized.slice(0, 2), normalized);
}

export function removeUploadedChunks(deviceDir: string, chunkShas: string[]): void {
  for (const sha of chunkShas) {
    try {
      fs.rmSync(chunkPathForDeviceDir(deviceDir, sha), { force: true });
    } catch {
      // Chunk cleanup is best effort.
    }
  }
}

/**
 * Moves legacy per-device blobs into the shared store without copying bytes
 * (hardlink + unlink on the same volume), then removes the empty legacy tree.
 */
export function consolidateDeviceBlobs(deviceDir: string): void {
  const legacyRoot = path.join(deviceDir, ".blobs");
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(legacyRoot, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(legacyRoot, entry.name);
    if (entry.isDirectory()) {
      consolidateLegacyPrefix(deviceDir, full);
      continue;
    }
    moveLegacyBlob(deviceDir, full);
  }
  removeEmptyLegacyTree(legacyRoot);
}

function consolidateLegacyPrefix(deviceDir: string, prefixDir: string): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(prefixDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) continue;
    moveLegacyBlob(deviceDir, path.join(prefixDir, entry.name));
  }
  try {
    if (fs.readdirSync(prefixDir).length === 0) fs.rmdirSync(prefixDir);
  } catch {
    // Changed concurrently; ignore.
  }
}

function moveLegacyBlob(deviceDir: string, legacyPath: string): void {
  const fileName = path.basename(legacyPath).toLowerCase();
  const sha = fileName.endsWith(COMPRESSED_SUFFIX) ? fileName.slice(0, -COMPRESSED_SUFFIX.length) : fileName;
  if (!/^[a-f0-9]{64}$/.test(sha)) return;
  const compressed = fileName.endsWith(COMPRESSED_SUFFIX);
  const target = compressed
    ? `${globalBlobPath(deviceDir, sha)}${COMPRESSED_SUFFIX}`
    : globalBlobPath(deviceDir, sha);
  if (fs.existsSync(target) || (!compressed && fs.existsSync(`${target}${COMPRESSED_SUFFIX}`))) {
    try {
      fs.rmSync(legacyPath, { force: true });
    } catch {
      // Best effort.
    }
    return;
  }
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.linkSync(legacyPath, target);
    fs.rmSync(legacyPath, { force: true });
  } catch {
    // A concurrent upload may have created the target; the next pass cleans up.
  }
}

function removeEmptyLegacyTree(legacyRoot: string): void {
  try {
    if (fs.readdirSync(legacyRoot).length === 0) fs.rmdirSync(legacyRoot);
  } catch {
    // Changed concurrently; ignore.
  }
}

/**
 * Compresses retained versions that are no longer live (not in `hotShas`)
 * and old enough that no running upload can reference them.
 */
export function compressColdBlobs(storeDir: string, hotShas: Set<string>): { compressed: number; savedBytes: number } {
  const blobsRoot = path.join(storeDir, ".blobs");
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(blobsRoot, { withFileTypes: true });
  } catch {
    return { compressed: 0, savedBytes: 0 };
  }
  let compressed = 0;
  let savedBytes = 0;
  const now = Date.now();
  const visit = (directory: string): void => {
    let children: fs.Dirent[];
    try {
      children = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of children) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(full);
        continue;
      }
      if (entry.name.endsWith(COMPRESSED_SUFFIX)) continue;
      if (!/^[a-f0-9]{64}$/i.test(entry.name) || hotShas.has(entry.name.toLowerCase())) continue;
      let stat: fs.Stats;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (!stat.isFile() || stat.size < COLD_BLOB_MIN_SIZE || now - stat.mtimeMs < COLD_BLOB_MIN_AGE_MS) continue;
      try {
        const gzipped = gzipSync(fs.readFileSync(full));
        if (gzipped.length >= stat.size) continue;
        const temporary = `${full}.${randomUUID()}.gz`;
        fs.writeFileSync(temporary, gzipped);
        fs.renameSync(temporary, `${full}${COMPRESSED_SUFFIX}`);
        fs.rmSync(full, { force: true });
        compressed += 1;
        savedBytes += stat.size - gzipped.length;
      } catch {
        // A single failure must not stop the pass.
      }
    }
  };
  visit(blobsRoot);
  return { compressed, savedBytes };
}

export function expectedChunkCount(sizeBytes: number, chunkSize: number): number {
  return Math.max(1, Math.ceil(sizeBytes / chunkSize));
}

export async function matchesFile(filePath: string, metadata: BackupFileMetadata): Promise<boolean> {
  try {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile() || stat.size !== metadata.sizeBytes) return false;
    const hash = createHash("sha256");
    for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
    return hash.digest("hex").toLowerCase() === metadata.sha256.toLowerCase();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

export function awaitMatchesFileSync(filePath: string, metadata: BackupFileMetadata): boolean {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size !== metadata.sizeBytes) return false;
    const hash = createHash("sha256");
    hash.update(fs.readFileSync(filePath));
    return hash.digest("hex").toLowerCase() === metadata.sha256.toLowerCase();
  } catch {
    return false;
  }
}

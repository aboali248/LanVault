import archiver from "archiver";
import archiverZipEncrypted from "archiver-zip-encrypted";
import { createCipheriv, createHmac, pbkdf2Sync, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { AppError } from "../../utils/errors";
import { hashFile } from "./backup-content";

archiver.registerFormat("zip-encrypted", archiverZipEncrypted);

const FIXED_ENTRY_DATE = new Date("1980-01-01T00:00:00Z");
const AES_STRENGTHS: Record<number, { salt: number; key: number; algorithm: string }> = {
  1: { salt: 8, key: 16, algorithm: "aes-128-ctr" },
  2: { salt: 12, key: 24, algorithm: "aes-192-ctr" },
  3: { salt: 16, key: 32, algorithm: "aes-256-ctr" },
};

/**
 * Packs a single file into a .zip archive (AES-256 when a password is set,
 * plain deflate otherwise). The inner name is the original file name so the
 * archive stays friendly when opened manually (7-Zip/WinRAR for AES).
 */
export async function createFileZip(content: Buffer, innerName: string, password?: string | null): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const archive = password
    ? archiver.create("zip-encrypted", { zlib: { level: 6 }, encryptionMethod: "aes256", password })
    : archiver.create("zip", { zlib: { level: 6 } });
  return new Promise<Buffer>((resolve, reject) => {
    archive.on("error", (error: unknown) => reject(error instanceof Error ? error : new Error(String(error))));
    archive.on("data", (data: Buffer) => chunks.push(data));
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.append(content, { name: innerName, date: FIXED_ENTRY_DATE });
    void archive.finalize();
  });
}

function crc32(data: Buffer): number {
  let table = CRC_TABLE;
  if (!table) {
    table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    CRC_TABLE = table;
  }
  let crc = 0xffffffff;
  for (const byte of data) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
let CRC_TABLE: Int32Array | null = null;

interface CentralEntry {
  method: number;
  crc: number;
  compressedSize: number;
  name: Buffer;
  extra: Buffer;
  localOffset: number;
}

function findCentralDirectory(zip: Buffer): { entries: number; offset: number } {
  const end = zip.length;
  const searchStart = Math.max(0, end - 22 - 65535);
  for (let offset = end - 22; offset >= searchStart; offset--) {
    if (zip.readUInt32LE(offset) !== 0x06054b50) continue;
    return { entries: zip.readUInt16LE(offset + 10), offset: zip.readUInt32LE(offset + 16) };
  }
  throw new AppError(400, "Not a readable zip archive");
}

function readCentralEntry(zip: Buffer, offset: number): { entry: CentralEntry; next: number } {
  if (zip.readUInt32LE(offset) !== 0x02014b50) throw new AppError(400, "Damaged zip directory");
  const method = zip.readUInt16LE(offset + 10);
  const crc = zip.readUInt32LE(offset + 16);
  const compressedSize = zip.readUInt32LE(offset + 20);
  const nameLength = zip.readUInt16LE(offset + 28);
  const extraLength = zip.readUInt16LE(offset + 30);
  const commentLength = zip.readUInt16LE(offset + 32);
  const localOffset = zip.readUInt32LE(offset + 42);
  const nameStart = offset + 46;
  const entry: CentralEntry = {
    method,
    crc,
    compressedSize,
    name: zip.subarray(nameStart, nameStart + nameLength),
    extra: zip.subarray(nameStart + nameLength, nameStart + nameLength + extraLength),
    localOffset,
  };
  return { entry, next: nameStart + nameLength + extraLength + commentLength };
}

function findAesExtra(extra: Buffer): { strength: number; method: number } | null {
  let offset = 0;
  while (offset + 4 <= extra.length) {
    const id = extra.readUInt16LE(offset);
    const size = extra.readUInt16LE(offset + 2);
    // WinZip AE layout after the 4-byte header: version(2), vendor "AE"(2), strength(1), method(2).
    if (id === 0x9901 && size >= 7 && offset + 11 <= extra.length) {
      return { strength: extra[offset + 8], method: extra.readUInt16LE(offset + 9) };
    }
    offset += 4 + size;
  }
  return null;
}

/**
 * Independent reader for the archives we write (plain store/deflate and
 * WinZip AES). Used to verify restores and to compare archived mirrors.
 */
export function readZipEntry(zip: Buffer, password?: string | null): { name: string; content: Buffer } {
  const central = findCentralDirectory(zip);
  if (central.entries < 1) throw new AppError(400, "Empty zip archive");
  const { entry } = readCentralEntry(zip, central.offset);
  const name = entry.name.toString("utf8");

  if (zip.readUInt32LE(entry.localOffset) !== 0x04034b50) throw new AppError(400, "Damaged zip data");
  const localNameLength = zip.readUInt16LE(entry.localOffset + 26);
  const localExtraLength = zip.readUInt16LE(entry.localOffset + 28);
  const dataStart = entry.localOffset + 30 + localNameLength + localExtraLength;
  const stored = zip.subarray(dataStart, dataStart + entry.compressedSize);
  if (stored.length !== entry.compressedSize) throw new AppError(400, "Truncated zip data");

  if (entry.method !== 99) {
    if (entry.method !== 0 && entry.method !== 8) {
      throw new AppError(400, `Unsupported zip method ${entry.method}`);
    }
    const content = entry.method === 8 ? inflateRawSync(stored) : Buffer.from(stored);
    if (entry.crc !== 0 && crc32(content) !== entry.crc) throw new AppError(400, "Zip CRC mismatch");
    return { name, content };
  }

  const aes = findAesExtra(entry.extra);
  if (!aes) throw new AppError(400, "Missing AES metadata");
  const params = AES_STRENGTHS[aes.strength];
  if (!params) throw new AppError(400, "Unsupported AES strength");
  if (aes.method !== 0 && aes.method !== 8) throw new AppError(400, `Unsupported zip method ${aes.method}`);
  if (!password) throw new AppError(400, "This archive requires a password");
  const salt = stored.subarray(0, params.salt);
  const verifier = stored.subarray(params.salt, params.salt + 2);
  const ciphertext = stored.subarray(params.salt + 2, stored.length - 10);
  const authCode = stored.subarray(stored.length - 10);
  const derived = pbkdf2Sync(Buffer.from(password, "utf8"), salt, 1000, 2 * params.key + 2, "sha1");
  if (!derived.subarray(2 * params.key).equals(verifier)) {
    throw new AppError(400, "Wrong archive password");
  }
  const hmac = createHmac("sha1", derived.subarray(params.key, 2 * params.key));
  hmac.update(ciphertext);
  if (!hmac.digest().subarray(0, 10).equals(authCode)) {
    throw new AppError(400, "Archive authentication failed");
  }
  const nonce = Buffer.alloc(16);
  nonce.writeUInt32LE(1, 0);
  const raw = aesCtrCrypt(params.key * 8, derived.subarray(0, params.key), ciphertext);
  return { name, content: aes.method === 8 ? inflateRawSync(raw) : raw };
}

/**
 * WinZip AES uses a 128-bit little-endian counter starting at 1, while
 * OpenSSL increments big-endian — so the keystream is built block by block
 * with AES-ECB, which any spec-compliant tool reproduces identically.
 */
function aesCtrCrypt(bits: number, key: Buffer, data: Buffer): Buffer {
  const out = Buffer.alloc(data.length);
  const blocks = Math.ceil(data.length / 16);
  for (let block = 0; block < blocks; block++) {
    const counter = Buffer.alloc(16);
    counter.writeBigUInt64LE(BigInt(block + 1), 0);
    const cipher = createCipheriv(`aes-${bits}-ecb`, key, null);
    cipher.setAutoPadding(false);
    const keystream = Buffer.concat([cipher.update(counter), cipher.final()]);
    const start = block * 16;
    const end = Math.min(data.length, start + 16);
    for (let i = start; i < end; i++) out[i] = data[i] ^ keystream[i - start];
  }
  return out;
}

/**
 * Streams a disk file into a single-entry .zip archive without loading it
 * into memory. Written atomically via a temporary file.
 */
export async function writeFileZip(
  targetPath: string,
  sourcePath: string,
  innerName: string,
  password?: string | null,
): Promise<void> {
  const temporary = `${targetPath}.${randomUUID()}.upload`;
  fs.mkdirSync(path.dirname(temporary), { recursive: true });
  try {
    await new Promise<void>((resolve, reject) => {
      const archive = password
        ? archiver.create("zip-encrypted", { zlib: { level: 6 }, encryptionMethod: "aes256", password })
        : archiver.create("zip", { zlib: { level: 6 } });
      const output = createWriteStream(temporary, { flags: "wx" });
      archive.on("error", (error: unknown) => reject(error instanceof Error ? error : new Error(String(error))));
      output.on("error", (error: unknown) => reject(error instanceof Error ? error : new Error(String(error))));
      output.on("close", () => resolve());
      archive.pipe(output);
      archive.file(sourcePath, { name: innerName, date: FIXED_ENTRY_DATE });
      void archive.finalize();
    });
    fs.renameSync(temporary, targetPath);
  } catch (error) {
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
      // Preserve the original error.
    }
    throw error;
  }
}

/**
 * Extracts an archived mirror to a temporary file for verification or
 * serving. Callers must invoke release().
 */
export function extractZipToTemp(zipPath: string, password?: string | null): { path: string; release: () => void } {
  const { content } = readZipEntry(fs.readFileSync(zipPath), password);
  const temporary = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lanvault-unzip-")), "file");
  fs.writeFileSync(temporary, content);
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
}

/**
 * Verifies an archived mirror holds exactly the expected original bytes.
 * Streams the hash so large files never sit fully in memory twice.
 */
export async function zipMatchesFile(
  zipPath: string,
  sizeBytes: number,
  sha256: string,
  password?: string | null,
): Promise<boolean> {
  let extracted: { path: string; release: () => void } | null = null;
  try {
    extracted = extractZipToTemp(zipPath, password);
    const stat = fs.statSync(extracted.path);
    if (!stat.isFile() || stat.size !== sizeBytes) return false;
    return (await hashFile(extracted.path)) === sha256.toLowerCase();
  } catch {
    return false;
  } finally {
    try {
      extracted?.release();
    } catch {
      // Temporary cleanup is best effort.
    }
  }
}

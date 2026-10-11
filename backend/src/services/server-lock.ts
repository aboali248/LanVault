import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function lockFilePath(dataDirectory: string): string {
  return path.join(dataDirectory, "lanvault-server.lock");
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code !== "ESRCH";
  }
  return true;
}

function looksLikeLanVaultServer(pid: number): boolean | null {
  try {
    if (process.platform === "win32") {
      const output = execFileSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", `Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' | Select-Object -ExpandProperty CommandLine`],
        { timeout: 8000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
      ).toString();
      if (!output.trim()) return false;
      return /server\.js|lanvault/i.test(output);
    }
    const commandLine = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ");
    if (!commandLine.trim()) return false;
    return /server\.js|lanvault/i.test(commandLine);
  } catch {
    return null;
  }
}

/**
 * Guarantees a single API server per data directory. Throws when another live
 * LanVault server holds the lock so dueling schedulers can never queue
 * duplicate backups. A stale lock from a crashed process is taken over.
 */
export function acquireServerLock(dataDirectory: string): () => void {
  const lockPath = lockFilePath(dataDirectory);
  try {
    fs.mkdirSync(dataDirectory, { recursive: true });
  } catch {
    // The database layer surfaces directory errors.
  }
  let previous: string | null = null;
  try {
    previous = fs.readFileSync(lockPath, "utf8").trim() || null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      console.warn(`Could not read server lock file '${lockPath}'; continuing without a lock.`);
      return () => undefined;
    }
  }
  if (previous) {
    const pid = Number.parseInt(previous, 10);
    if (Number.isSafeInteger(pid) && isProcessAlive(pid)) {
      const identity = looksLikeLanVaultServer(pid);
      if (identity !== false) {
        throw new Error(
          `Another LanVault API server is already running (PID ${pid}). ` +
          `Stop it before starting a new one. If no server is running, delete '${lockPath}' and retry.`,
        );
      }
    }
  }
  try {
    fs.writeFileSync(lockPath, String(process.pid), "utf8");
  } catch (error) {
    console.warn(`Could not write server lock file '${lockPath}'; continuing without a lock.`);
    return () => undefined;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      if (fs.readFileSync(lockPath, "utf8").trim() === String(process.pid)) {
        fs.rmSync(lockPath, { force: true });
      }
    } catch {
      // Best effort on shutdown.
    }
  };
}

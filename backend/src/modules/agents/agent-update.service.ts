import fs from "node:fs";
import path from "node:path";
import { AppError } from "../../utils/errors";

export interface PublishedAgent {
  executablePath: string;
  version: string;
  buildHash: string;
}

export function getPublishedAgentIfAvailable(): PublishedAgent | null {
  const runtimeDirectory = path.resolve(process.cwd(), ".runtime", "agent");
  const executablePath = path.join(runtimeDirectory, "LanVault.Agent.exe");
  const manifestPath = path.join(runtimeDirectory, "LanVault.Agent.manifest");
  if (!fs.existsSync(executablePath) || !fs.existsSync(manifestPath)) return null;

  return readPublishedAgent(executablePath, manifestPath);
}

export function getPublishedAgent(): PublishedAgent {
  const runtimeDirectory = path.resolve(process.cwd(), ".runtime", "agent");
  const executablePath = path.join(runtimeDirectory, "LanVault.Agent.exe");
  const manifestPath = path.join(runtimeDirectory, "LanVault.Agent.manifest");
  if (!fs.existsSync(executablePath) || !fs.existsSync(manifestPath)) {
    throw new AppError(503, "The published Agent update is unavailable. Publish the Agent package on the server first.");
  }

  return readPublishedAgent(executablePath, manifestPath);
}

function readPublishedAgent(executablePath: string, manifestPath: string): PublishedAgent {
  const [version, buildHash, ...extra] = fs.readFileSync(manifestPath, "utf8").trim().split("|");
  if (!version || !/^[a-f0-9]{64}$/i.test(buildHash ?? "") || extra.length > 0) {
    throw new AppError(503, "The published Agent update manifest is invalid.");
  }
  return { executablePath, version, buildHash: buildHash.toUpperCase() };
}

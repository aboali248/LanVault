import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler } from "express";
import { config } from "../../config";
import { AppError } from "../../utils/errors";

export type UserRole = "admin" | "user";

interface TokenPayload {
  role: UserRole;
  expiresAt: number;
}

const tokenLifetimeSeconds = 8 * 60 * 60;

function secureEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left, "utf8").digest();
  const rightHash = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftHash, rightHash);
}

function signature(payload: string): string {
  return createHmac("sha256", config.authTokenSecret).update(payload).digest("base64url");
}

export function createAccessToken(role: UserRole): string {
  const payload = Buffer.from(JSON.stringify({
    role,
    expiresAt: Math.floor(Date.now() / 1000) + tokenLifetimeSeconds,
  } satisfies TokenPayload)).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function getTokenRole(token: string): UserRole | null {
  const [payload, suppliedSignature, extra] = token.split(".");
  if (!payload || !suppliedSignature || extra) return null;
  if (!secureEqual(signature(payload), suppliedSignature)) return null;

  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<TokenPayload>;
    if ((value.role !== "admin" && value.role !== "user") ||
        typeof value.expiresAt !== "number" || value.expiresAt <= Math.floor(Date.now() / 1000)) return null;
    return value.role;
  } catch {
    return null;
  }
}

export function roleFromRequest(request: Request): UserRole | null {
  const authorization = request.header("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  return token ? getTokenRole(token) : null;
}

export const requireUser: RequestHandler = (request, _response, next) => {
  if (!roleFromRequest(request)) {
    next(new AppError(401, "Sign in is required"));
    return;
  }
  next();
};

export const requireAdmin: RequestHandler = (request, _response, next) => {
  const role = roleFromRequest(request);
  if (!role) {
    next(new AppError(401, "Sign in is required"));
    return;
  }
  if (role !== "admin") {
    next(new AppError(403, "Administrator access is required"));
    return;
  }
  next();
};

export function authenticateCredentials(username: string, password: string): UserRole | null {
  if (username === "admin" && secureEqual(password, config.adminPassword)) return "admin";
  if (username === "user" && secureEqual(password, config.userPassword)) return "user";
  return null;
}

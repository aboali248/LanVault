import { Router } from "express";
import { z } from "zod";
import { createAccessToken, authenticateCredentials } from "./auth.service";
import { asyncHandler, AppError } from "../../utils/errors";

export const authRouter = Router();

const loginSchema = z.object({
  username: z.enum(["admin", "user"]),
  password: z.string().min(1).max(256),
}).strict();
const loginAttempts = new Map<string, { count: number; startedAt: number }>();
const attemptWindowMs = 15 * 60 * 1000;
const maximumAttempts = 5;

authRouter.post("/login", asyncHandler((request, response) => {
  const { username, password } = loginSchema.parse(request.body);
  const now = Date.now();
  const client = request.ip || request.socket.remoteAddress || "unknown";
  for (const [key, value] of loginAttempts) {
    if (now - value.startedAt >= attemptWindowMs) loginAttempts.delete(key);
  }
  const attempts = loginAttempts.get(client);
  if (attempts && now - attempts.startedAt < attemptWindowMs && attempts.count >= maximumAttempts) {
    throw new AppError(429, "Too many sign-in attempts. Try again in 15 minutes.");
  }

  const role = authenticateCredentials(username, password);
  if (!role) {
    const current = attempts && now - attempts.startedAt < attemptWindowMs
      ? attempts
      : { count: 0, startedAt: now };
    current.count += 1;
    loginAttempts.set(client, current);
    throw new AppError(401, "Username or password is incorrect");
  }

  loginAttempts.delete(client);
  response.json({ data: { token: createAccessToken(role), role, expiresIn: 8 * 60 * 60 } });
}));

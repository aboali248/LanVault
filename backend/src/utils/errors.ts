import type { NextFunction, Request, RequestHandler, Response } from "express";

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(statusCode: number, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

export const asyncHandler = (handler: RequestHandler): RequestHandler =>
  (request: Request, response: Response, next: NextFunction) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };

export function assertFound<T>(value: T | undefined, message = "Resource not found"): T {
  if (!value) {
    throw new AppError(404, message);
  }
  return value;
}

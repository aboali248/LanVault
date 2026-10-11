import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { AppError } from "../utils/errors";

export const notFoundHandler: RequestHandler = (request, response) => {
  response.status(404).json({ error: { code: "NOT_FOUND", message: `Route ${request.method} ${request.path} was not found` } });
};

export const errorHandler: ErrorRequestHandler = (error: unknown, request, response, _next) => {
  if (request.aborted && error instanceof Error && "code" in error && error.code === "ECONNRESET") {
    console.warn("Client aborted API request", request.method, request.path);
    return;
  }
  if (error instanceof ZodError) {
    response.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: error.flatten(),
      },
    });
    return;
  }
  if (error instanceof AppError) {
    response.status(error.statusCode).json({
      error: {
        code: error.statusCode === 404 ? "NOT_FOUND" : error.statusCode === 409 ? "CONFLICT" : "REQUEST_ERROR",
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    });
    return;
  }
  console.error("Unhandled API error", error);
  response.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
};

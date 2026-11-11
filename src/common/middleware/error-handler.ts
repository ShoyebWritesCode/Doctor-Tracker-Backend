import type { ErrorRequestHandler } from "express";
import { AppError } from "../errors/app-error.js";

type ErrorWithStatus = Error & {
  status?: number;
  statusCode?: number;
  type?: string;
};

function requestIdFromHeader(value: number | string | string[] | undefined): string {
  if (typeof value === "string") {
    return value;
  }

  return "unknown";
}

function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    const httpError = error as ErrorWithStatus;

    if (httpError.type === "entity.parse.failed") {
      return new AppError({
        code: "VALIDATION_ERROR",
        message: "Request body contains invalid JSON.",
        statusCode: 400,
      });
    }

    const statusCode = httpError.statusCode ?? httpError.status;
    if (statusCode === 413) {
      return new AppError({
        code: "VALIDATION_ERROR",
        message: "Request body is too large.",
        statusCode: 413,
      });
    }
  }

  return new AppError({
    code: "INTERNAL_ERROR",
    isOperational: false,
    message: "An unexpected error occurred.",
    statusCode: 500,
  });
}

export const errorHandler: ErrorRequestHandler = (error, request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  const normalized = normalizeError(error);
  const requestId = requestIdFromHeader(response.getHeader("X-Request-Id"));

  if (!normalized.isOperational) {
    // Persistence errors may embed submitted values. Retain correlation and error
    // classification without serializing patient fields, database messages or notes.
    request.log.error(
      {
        errorType: error instanceof Error ? error.name : "UnknownError",
        code: normalized.code,
        requestId,
      },
      "Unhandled request error",
    );
  }

  response.status(normalized.statusCode).json({
    error: {
      code: normalized.code,
      ...(normalized.fieldErrors ? { fieldErrors: normalized.fieldErrors } : {}),
      message: normalized.message,
      requestId,
    },
  });
};

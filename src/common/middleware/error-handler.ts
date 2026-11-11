import type { ErrorRequestHandler } from "express";
import { AppError } from "../errors/app-error.js";
import { safeErrorDetails } from "../http/safe-error.js";

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
  if (error instanceof AppError && error.isOperational && error.statusCode !== 500) {
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

    if (httpError.type === "encoding.unsupported" || httpError.type === "charset.unsupported") {
      return new AppError({
        code: "UNSUPPORTED_MEDIA_TYPE",
        message: "The request encoding is not supported.",
        statusCode: 415,
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

// Express recognizes error middleware by its four-argument arity, even without delegation.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
  if (response.headersSent) {
    // Express's default handler prints the raw exception. Close a partial response
    // ourselves so a late database error cannot leak patient values to stderr.
    request.log.error(
      {
        ...safeErrorDetails(error),
        requestId: requestIdFromHeader(response.getHeader("X-Request-Id")),
      },
      "Response failed after headers were sent",
    );
    response.destroy();
    return;
  }

  const normalized = normalizeError(error);
  const requestId = requestIdFromHeader(response.getHeader("X-Request-Id"));

  if (!normalized.isOperational) {
    // Persistence errors may embed submitted values. Retain correlation and error
    // classification without serializing patient fields, database messages or notes.
    request.log.error(
      {
        ...safeErrorDetails(error),
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

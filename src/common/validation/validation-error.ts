import type { ZodError } from "zod";
import { AppError } from "../errors/app-error.js";

export function validationError(error: ZodError): AppError {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = issue.path.map(String).join(".") || "request";
    (fieldErrors[field] ??= []).push(issue.message);
  }
  return new AppError({
    code: "VALIDATION_ERROR",
    fieldErrors,
    message: "The request contains invalid fields.",
    statusCode: 400,
  });
}

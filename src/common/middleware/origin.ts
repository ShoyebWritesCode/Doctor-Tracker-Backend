import type { RequestHandler } from "express";
import { AppError } from "../errors/app-error.js";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

export function requireTrustedOrigin(frontendOrigin: string, nodeEnv: string): RequestHandler {
  return (request, _response, next) => {
    if (safeMethods.has(request.method)) {
      next();
      return;
    }

    const origin = request.get("Origin");
    if (origin === frontendOrigin || (nodeEnv === "test" && origin === undefined)) {
      next();
      return;
    }

    next(
      new AppError({
        code: "ORIGIN_NOT_ALLOWED",
        message: "The request origin is not allowed.",
        statusCode: 403,
      }),
    );
  };
}

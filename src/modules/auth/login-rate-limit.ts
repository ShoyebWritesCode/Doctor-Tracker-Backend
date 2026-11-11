import { createHash } from "node:crypto";
import type { Request, RequestHandler } from "express";
import { AppError } from "../../common/errors/app-error.js";
import { LoginAttemptModel } from "./login-attempt.model.js";

function rateLimit(keyFor: (request: Request) => string, limit: number): RequestHandler {
  const windowMs = 15 * 60 * 1000;

  return async (request, response, next) => {
    try {
      const now = Date.now();
      const windowStart = Math.floor(now / windowMs) * windowMs;
      const resetAt = windowStart + windowMs;
      // A shared atomic counter survives cold starts and multiple function instances.
      // Only a digest is persisted: never raw account names or IP addresses.
      const entry = await LoginAttemptModel.findOneAndUpdate(
        { _id: digest(`${keyFor(request)}:${windowStart}`) },
        { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(resetAt) } },
        { upsert: true, returnDocument: "after" },
      )
        .lean()
        .exec();
      if (!entry) throw new Error("Login counter unavailable");

      response.setHeader("RateLimit-Limit", String(limit));
      response.setHeader("RateLimit-Remaining", String(Math.max(0, limit - entry.count)));
      response.setHeader("RateLimit-Reset", String(Math.ceil(resetAt / 1000)));

      if (entry.count > limit) {
        response.setHeader("Retry-After", String(Math.max(1, Math.ceil((resetAt - now) / 1000))));
        next(
          new AppError({
            code: "RATE_LIMITED",
            message: "Too many login attempts. Try again later.",
            statusCode: 429,
          }),
        );
        return;
      }
      next();
    } catch {
      next(
        new AppError({
          code: "SERVICE_UNAVAILABLE",
          message: "Sign-in is temporarily unavailable. Try again later.",
          statusCode: 503,
        }),
      );
    }
  };
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createLoginRateLimiters(
  ipLimit: number,
  accountLimit: number,
): [RequestHandler, RequestHandler] {
  const byIp = rateLimit(
    (request) => `ip:${request.ip ?? request.socket.remoteAddress ?? "unknown"}`,
    ipLimit,
  );
  const byAccount = rateLimit((request) => {
    const body: unknown = request.body;
    const emailValue =
      typeof body === "object" && body !== null && "email" in body ? body.email : undefined;
    const email = typeof emailValue === "string" ? emailValue.trim().toLowerCase() : "missing";
    return `account:${digest(email)}`;
  }, accountLimit);
  return [byIp, byAccount];
}

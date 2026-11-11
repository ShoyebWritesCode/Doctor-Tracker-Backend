import { createHash } from "node:crypto";
import type { Request, RequestHandler } from "express";
import { AppError } from "../../common/errors/app-error.js";

type Entry = { count: number; resetAt: number };

function rateLimit(keyFor: (request: Request) => string, limit: number): RequestHandler {
  const entries = new Map<string, Entry>();
  const windowMs = 15 * 60 * 1000;

  return (request, response, next) => {
    const now = Date.now();
    const key = keyFor(request);
    const current = entries.get(key);
    const entry =
      !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current;
    entry.count += 1;
    entries.set(key, entry);

    response.setHeader("RateLimit-Limit", String(limit));
    response.setHeader("RateLimit-Remaining", String(Math.max(0, limit - entry.count)));
    response.setHeader("RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > limit) {
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

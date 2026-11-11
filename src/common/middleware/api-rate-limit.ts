import { createHash } from "node:crypto";
import type { RequestHandler } from "express";
import { AppError } from "../errors/app-error.js";
import { RequestLimitModel } from "../http/request-limit.model.js";
import { safeErrorDetails } from "../http/safe-error.js";

/** Atomic, shared fixed-window limit; health and preflight never consume it. */
export function apiRateLimit(limit: number): RequestHandler {
  return async (request, response, next) => {
    try {
      const now = Date.now();
      const windowStart = Math.floor(now / 60_000) * 60_000;
      const resetAt = windowStart + 60_000;
      const _id = createHash("sha256")
        .update(`api:${request.ip ?? request.socket.remoteAddress ?? "unknown"}:${windowStart}`)
        .digest("hex");
      const update = { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(resetAt) } };
      let entry;
      try {
        entry = await RequestLimitModel.findOneAndUpdate({ _id }, update, {
          upsert: true,
          returnDocument: "after",
        })
          .maxTimeMS(2000)
          .lean()
          .exec();
      } catch (error) {
        // Concurrent first requests can race on the unique ID. The rejected insert
        // changed nothing, so only its counter increment is retried (never the API action).
        if (!(
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === 11000
        ))
          throw error;
        entry = await RequestLimitModel.findOneAndUpdate(
          { _id },
          { $inc: { count: 1 } },
          { returnDocument: "after" },
        )
          .maxTimeMS(2000)
          .lean()
          .exec();
      }
      if (!entry) throw new Error("Request counter unavailable");
      response.setHeader("RateLimit-Limit", String(limit));
      response.setHeader("RateLimit-Remaining", String(Math.max(0, limit - entry.count)));
      response.setHeader("RateLimit-Reset", String(Math.ceil(resetAt / 1000)));
      if (entry.count > limit) {
        response.setHeader("Retry-After", String(Math.max(1, Math.ceil((resetAt - now) / 1000))));
        next(
          new AppError({
            code: "RATE_LIMITED",
            message: "Too many requests. Try again later.",
            statusCode: 429,
          }),
        );
        return;
      }
      next();
    } catch (error) {
      request.log.warn(
        { ...safeErrorDetails(error), dependency: "request-limit-store" },
        "Request limiter unavailable",
      );
      next(
        new AppError({
          code: "SERVICE_UNAVAILABLE",
          message: "The service is temporarily unavailable. Try again later.",
          statusCode: 503,
        }),
      );
    }
  };
}

import { Router } from "express";
import { z } from "zod";
import type { AppConfig } from "../../config/env.js";
import { AppError } from "../../common/errors/app-error.js";
import { requireTrustedOrigin } from "../../common/middleware/origin.js";
import { AdminModel, toAdminDto } from "./admin.model.js";
import { authenticate } from "./auth.middleware.js";
import { serializeClearedSessionCookie, serializeSessionCookie } from "./cookie.js";
import { createLoginRateLimiters } from "./login-rate-limit.js";
import { verifyPassword } from "./password.js";
import { SessionModel } from "./session.model.js";
import { createSessionToken, hashSessionToken } from "./session-token.js";

const dummyPasswordHash =
  "$argon2id$v=19$m=19456,t=2,p=1$+eb0YFCkPIJNfffLPGzZlg$d6h2sqiykU4JMz2NIHtn+oMqx4VwYvhtQcdtYEYtQDo";
const loginSchema = z.strictObject({
  email: z
    .string()
    .trim()
    .pipe(z.email())
    .transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(128),
});

function invalidCredentials(): AppError {
  return new AppError({
    code: "INVALID_CREDENTIALS",
    message: "The email or password is incorrect.",
    statusCode: 401,
  });
}

function validationError(error: z.ZodError): AppError {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "body");
    (fieldErrors[field] ??= []).push(issue.message);
  }
  return new AppError({
    code: "VALIDATION_ERROR",
    fieldErrors,
    message: "The request contains invalid fields.",
    statusCode: 400,
  });
}

export function createAuthRouter(config: AppConfig): Router {
  const router = Router();
  const origin = requireTrustedOrigin(config.FRONTEND_ORIGIN, config.NODE_ENV);
  const [ipRateLimit, accountRateLimit] = createLoginRateLimiters(
    config.LOGIN_IP_LIMIT,
    config.LOGIN_ACCOUNT_LIMIT,
  );

  router.post("/login", origin, ipRateLimit, accountRateLimit, async (request, response, next) => {
    try {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        next(validationError(parsed.error));
        return;
      }

      const admin = await AdminModel.findOne({ email: parsed.data.email })
        .select("+passwordHash")
        .exec();
      const passwordHash = admin?.passwordHash ?? dummyPasswordHash;
      const passwordMatches = await verifyPassword(passwordHash, parsed.data.password);
      if (!admin || admin.status !== "active" || !passwordMatches) {
        next(invalidCredentials());
        return;
      }

      const token = createSessionToken();
      const expiresAt = new Date(Date.now() + config.SESSION_TTL_HOURS * 60 * 60 * 1000);
      const userAgent = request.get("User-Agent")?.slice(0, 300);
      await SessionModel.create({
        adminId: admin._id,
        expiresAt,
        tokenHash: hashSessionToken(token),
        ...(userAgent ? { userAgent } : {}),
      });
      admin.lastLoginAt = new Date();
      await admin.save();

      response.setHeader(
        "Set-Cookie",
        serializeSessionCookie({
          expires: expiresAt,
          name: config.SESSION_COOKIE_NAME,
          secure: config.COOKIE_SECURE,
          token,
        }),
      );
      response.status(200).json({ data: toAdminDto(admin) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/me", authenticate(config), (request, response) => {
    response.status(200).json({ data: request.auth?.admin });
  });

  router.post("/logout", origin, authenticate(config), async (request, response, next) => {
    try {
      await SessionModel.deleteOne({ _id: request.auth?.sessionId }).exec();
      response.setHeader(
        "Set-Cookie",
        serializeClearedSessionCookie(config.SESSION_COOKIE_NAME, config.COOKIE_SECURE),
      );
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}

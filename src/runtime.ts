import type { Express } from "express";
import type { Logger } from "pino";
import { createApp, AppError } from "./app.js";
import type { AppConfig } from "./config/env.js";
import { checkMongoReadiness } from "./database/mongo.js";
import { createAuthRouter } from "./modules/auth/auth.routes.js";
import { createDoctorRouter } from "./modules/doctors/doctor.routes.js";
import { createDashboardRouter } from "./modules/dashboard/dashboard.routes.js";
import { apiRateLimit } from "./common/middleware/api-rate-limit.js";
import { requireTrustedOrigin } from "./common/middleware/origin.js";
import {
  createPatientRouter,
  createScopedPatientRouter,
} from "./modules/patients/patient.routes.js";

/** Share routing between the standalone server and the serverless entry point. */
export function createRuntimeApp(
  config: AppConfig,
  logger: Logger,
  prepareDatabase?: () => Promise<void>,
): Express {
  return createApp({
    logger,
    trustProxyHops: config.TRUST_PROXY_HOPS,
    frontendOrigin: config.FRONTEND_ORIGIN,
    secureTransport: config.COOKIE_SECURE,
    isReady: async () => {
      await prepareDatabase?.();
      return checkMongoReadiness();
    },
    registerRoutes: (app) => {
      app.use("/api/v1", requireTrustedOrigin(config.FRONTEND_ORIGIN, config.NODE_ENV));
      if (prepareDatabase) {
        app.use("/api/v1", async (_request, _response, next) => {
          try {
            await prepareDatabase();
            next();
          } catch {
            next(
              new AppError({
                code: "SERVICE_UNAVAILABLE",
                message: "The service is not ready to accept requests.",
                statusCode: 503,
              }),
            );
          }
        });
      }
      app.use("/api/v1", apiRateLimit(config.API_RATE_LIMIT));
      app.use("/api/v1/auth", createAuthRouter(config));
      app.use("/api/v1/dashboard", createDashboardRouter(config));
      app.use("/api/v1/doctors/:doctorId/patients", createScopedPatientRouter(config));
      app.use("/api/v1/doctors", createDoctorRouter(config));
      app.use("/api/v1/patients", createPatientRouter(config));
    },
  });
}

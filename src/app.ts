import express, { type Express } from "express";
import type { Logger } from "pino";
import { AppError } from "./common/errors/app-error.js";
import { requestLogger } from "./common/http/request-logger.js";
import { errorHandler } from "./common/middleware/error-handler.js";
import { notFound } from "./common/middleware/not-found.js";

type CreateAppOptions = {
  isReady?: () => Promise<boolean>;
  logger: Logger;
  registerRoutes?: (app: Express) => void;
  trustProxyHops?: number;
};

export function createApp(options: CreateAppOptions): Express {
  const app = express();

  app.disable("x-powered-by");
  if (options.trustProxyHops && options.trustProxyHops > 0) {
    app.set("trust proxy", options.trustProxyHops);
  }
  app.use(requestLogger(options.logger));
  app.use(express.json({ limit: "100kb" }));

  app.get("/health", (_request, response) => {
    response.status(200).json({ data: { status: "ok" } });
  });

  app.get("/ready", async (_request, response, next) => {
    try {
      const ready = await (options.isReady?.() ?? Promise.resolve(true));
      if (!ready) {
        next(
          new AppError({
            code: "SERVICE_UNAVAILABLE",
            message: "The service is not ready to accept requests.",
            statusCode: 503,
          }),
        );
        return;
      }
      response.status(200).json({ data: { status: "ready" } });
    } catch (error) {
      next(error);
    }
  });

  options.registerRoutes?.(app);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

export { AppError };

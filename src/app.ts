import express, { type Express } from "express";
import type { Logger } from "pino";
import { AppError } from "./common/errors/app-error.js";
import { requestLogger } from "./common/http/request-logger.js";
import { errorHandler } from "./common/middleware/error-handler.js";
import { notFound } from "./common/middleware/not-found.js";

type CreateAppOptions = {
  logger: Logger;
  registerRoutes?: (app: Express) => void;
};

export function createApp(options: CreateAppOptions): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(requestLogger(options.logger));
  app.use(express.json({ limit: "100kb" }));

  app.get("/health", (_request, response) => {
    response.status(200).json({ data: { status: "ok" } });
  });

  options.registerRoutes?.(app);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

export { AppError };

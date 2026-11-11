import "dotenv/config";
import type { Server } from "node:http";
import { createHttpServer, closeHttpServer } from "./common/http/server-policy.js";
import { createRuntimeApp } from "./runtime.js";
import { parseEnv } from "./config/env.js";
import { createLogger } from "./config/logger.js";
import { connectMongo, disconnectMongo } from "./database/mongo.js";

const config = parseEnv(process.env);
const logger = createLogger({ level: config.LOG_LEVEL, nodeEnv: config.NODE_ENV });
let server: Server | undefined;
let shuttingDown = false;

async function shutdown(reason: string, exitCode: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ reason }, "Shutting down API server");

  const forceExitTimer = setTimeout(() => {
    logger.error("Graceful shutdown timed out");
    server?.closeAllConnections();
    process.exit(1);
  }, 10_000);
  forceExitTimer.unref();

  try {
    if (server) await closeHttpServer(server);
    await disconnectMongo(logger);
    clearTimeout(forceExitTimer);
    logger.flush();
    process.exit(exitCode);
  } catch (error) {
    clearTimeout(forceExitTimer);
    logger.error({ err: error }, "Failed to stop API server cleanly");
    logger.flush();
    process.exit(1);
  }
}

async function start(): Promise<void> {
  try {
    await connectMongo({ logger, uri: config.MONGODB_URI });
  } catch (error) {
    logger.fatal({ err: error }, "MongoDB connection failed during startup");
    logger.flush();
    process.exitCode = 1;
    return;
  }

  const app = createRuntimeApp(config, logger);
  server = createHttpServer(app);
  server.on("error", (error) => {
    logger.fatal({ err: error }, "API server failed");
    void shutdown("server error", 1);
  });
  server.listen(config.PORT, config.HOST, () => {
    logger.info({ host: config.HOST, port: config.PORT }, "Doctor Tracker API is listening");
  });
}

process.once("SIGINT", () => void shutdown("SIGINT", 0));
process.once("SIGTERM", () => void shutdown("SIGTERM", 0));
process.once("uncaughtException", (error) => {
  logger.fatal({ err: error }, "Uncaught exception");
  void shutdown("uncaught exception", 1);
});
process.once("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "Unhandled promise rejection");
  void shutdown("unhandled rejection", 1);
});

await start();

import "dotenv/config";
import { createServer, type Server } from "node:http";
import { createApp } from "./app.js";
import { parseEnv } from "./config/env.js";
import { createLogger } from "./config/logger.js";

const config = parseEnv(process.env);
const logger = createLogger({ level: config.LOG_LEVEL, nodeEnv: config.NODE_ENV });
const app = createApp({ logger });
const server = createServer(app);

server.headersTimeout = 65_000;
server.keepAliveTimeout = 5_000;
server.requestTimeout = 30_000;

let shuttingDown = false;

function closeServer(httpServer: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    httpServer.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function shutdown(reason: string, exitCode: number): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info({ reason }, "Shutting down API server");

  const forceExitTimer = setTimeout(() => {
    logger.error("Graceful shutdown timed out");
    server.closeAllConnections();
    process.exit(1);
  }, 10_000);
  forceExitTimer.unref();

  try {
    await closeServer(server);
    clearTimeout(forceExitTimer);
    logger.info("API server stopped");
    process.exit(exitCode);
  } catch (error) {
    clearTimeout(forceExitTimer);
    logger.error({ err: error }, "Failed to stop API server cleanly");
    process.exit(1);
  }
}

server.listen(config.PORT, config.HOST, () => {
  logger.info({ host: config.HOST, port: config.PORT }, "Doctor Tracker API is listening");
});

server.on("error", (error) => {
  logger.fatal({ err: error }, "API server failed");
  void shutdown("server error", 1);
});

process.once("SIGINT", () => {
  void shutdown("SIGINT", 0);
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM", 0);
});

process.once("uncaughtException", (error) => {
  logger.fatal({ err: error }, "Uncaught exception");
  void shutdown("uncaught exception", 1);
});

process.once("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "Unhandled promise rejection");
  void shutdown("unhandled rejection", 1);
});

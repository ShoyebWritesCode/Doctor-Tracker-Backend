import mongoose from "mongoose";
import type { Logger } from "pino";
import { monitorSlowQueries } from "./slow-queries.js";

type MongoOptions = {
  logger: Logger;
  uri: string;
  slowQueryMs?: number;
};

let connecting: Promise<void> | undefined;
let stopMonitoring: (() => void) | undefined;

export async function connectMongo({
  logger,
  uri,
  slowQueryMs = process.env.NODE_ENV === "development" ? 250 : 0,
}: MongoOptions): Promise<void> {
  if (isMongoConnected()) return;
  if (connecting) return connecting;
  mongoose.set("strictQuery", true);
  connecting = mongoose
    .connect(uri, {
      autoIndex: process.env.NODE_ENV !== "production",
      serverSelectionTimeoutMS: 10_000,
      maxPoolSize: 5,
      minPoolSize: 0,
      maxIdleTimeMS: 60_000,
      monitorCommands: slowQueryMs > 0,
    })
    .then(() => {
      if (slowQueryMs > 0)
        stopMonitoring = monitorSlowQueries(mongoose.connection.getClient(), logger, slowQueryMs);
      logger.info("MongoDB connection established");
    })
    .finally(() => {
      connecting = undefined;
    });
  return connecting;
}

export async function disconnectMongo(logger: Logger): Promise<void> {
  stopMonitoring?.();
  stopMonitoring = undefined;
  if (mongoose.connection.readyState === mongoose.STATES.disconnected) return;
  await mongoose.disconnect();
  logger.info("MongoDB connection closed");
}

export function isMongoConnected(): boolean {
  return mongoose.connection.readyState === mongoose.STATES.connected;
}

export async function checkMongoReadiness(): Promise<boolean> {
  if (!isMongoConnected() || !mongoose.connection.db) return false;
  try {
    await mongoose.connection.db.admin().ping();
    return true;
  } catch {
    return false;
  }
}

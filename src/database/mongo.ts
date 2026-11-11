import mongoose from "mongoose";
import type { Logger } from "pino";

type MongoOptions = {
  logger: Logger;
  uri: string;
};

let connecting: Promise<void> | undefined;

export async function connectMongo({ logger, uri }: MongoOptions): Promise<void> {
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
    })
    .then(() => {
      logger.info("MongoDB connection established");
    })
    .finally(() => {
      connecting = undefined;
    });
  return connecting;
}

export async function disconnectMongo(logger: Logger): Promise<void> {
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

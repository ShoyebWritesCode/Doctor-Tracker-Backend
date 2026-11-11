import "dotenv/config";
import { pathToFileURL } from "node:url";
import type { Logger } from "pino";
import { parseEnv, parseSeedEnv, type SeedConfig } from "../config/env.js";
import { createLogger } from "../config/logger.js";
import { connectMongo, disconnectMongo } from "../database/mongo.js";
import { AdminModel } from "../modules/auth/admin.model.js";
import { hashPassword } from "../modules/auth/password.js";

export async function seedAdmin(config: SeedConfig): Promise<"created" | "updated"> {
  const existing = await AdminModel.exists({ email: config.SEED_ADMIN_EMAIL });
  const passwordHash = await hashPassword(config.SEED_ADMIN_PASSWORD);
  await AdminModel.updateOne(
    { email: config.SEED_ADMIN_EMAIL },
    {
      $set: {
        name: config.SEED_ADMIN_NAME,
        passwordHash,
        status: "active",
      },
      $setOnInsert: { email: config.SEED_ADMIN_EMAIL },
    },
    { runValidators: true, upsert: true },
  ).exec();
  return existing ? "updated" : "created";
}

async function run(logger: Logger): Promise<void> {
  const appConfig = parseEnv(process.env);
  const seedConfig = parseSeedEnv(process.env);
  await connectMongo({ logger, uri: appConfig.MONGODB_URI });
  try {
    const outcome = await seedAdmin(seedConfig);
    logger.info({ outcome }, "Administrator seed completed");
  } finally {
    await disconnectMongo(logger);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const nodeEnv = process.env.NODE_ENV === "production" ? "production" : "development";
  const logger = createLogger({ level: process.env.LOG_LEVEL ?? "info", nodeEnv });
  run(logger).catch((error: unknown) => {
    logger.fatal({ err: error }, "Administrator seed failed");
    process.exitCode = 1;
  });
}

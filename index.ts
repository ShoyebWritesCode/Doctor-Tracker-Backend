import express from "express";
import { parseEnv } from "./src/config/env.js";
import { createLogger } from "./src/config/logger.js";
import { connectMongo } from "./src/database/mongo.js";
import { createRuntimeApp } from "./src/runtime.js";

const config = parseEnv(process.env);
const logger = createLogger({ level: config.LOG_LEVEL, nodeEnv: config.NODE_ENV });

// Vercel owns the listener and process lifecycle. Connect lazily and reuse the pool.
const app = express();
app.disable("x-powered-by");
app.use(createRuntimeApp(config, logger, () => connectMongo({ logger, uri: config.MONGODB_URI })));

export default app;

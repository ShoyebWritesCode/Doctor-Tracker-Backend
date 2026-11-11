import { createServer, type Server } from "node:http";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createApp } from "../../src/app.js";
import { parseEnv } from "../../src/config/env.js";
import { checkMongoReadiness, connectMongo, disconnectMongo } from "../../src/database/mongo.js";
import { AdminModel } from "../../src/modules/auth/admin.model.js";
import { createAuthRouter } from "../../src/modules/auth/auth.routes.js";
import { SessionModel } from "../../src/modules/auth/session.model.js";
import { DoctorModel } from "../../src/modules/doctors/doctor.model.js";
import { createDoctorRouter } from "../../src/modules/doctors/doctor.routes.js";
import { PatientModel } from "../../src/modules/patients/patient.model.js";
import {
  createPatientRouter,
  createScopedPatientRouter,
} from "../../src/modules/patients/patient.routes.js";
import { seedAdmin } from "../../src/scripts/seed-admin.js";
import { createDashboardRouter } from "../../src/modules/dashboard/dashboard.routes.js";
import { createTestLogger } from "./logger.js";

// Explicit, disposable browser-test infrastructure. Never connects to an existing database.
const logger = createTestLogger();
let mongo: MongoMemoryReplSet | undefined;
let server: Server | undefined;
let stopping = false;

async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  if (server?.listening) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
  await disconnectMongo(logger);
  await mongo?.stop();
}

try {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const config = parseEnv({
    NODE_ENV: "development",
    FRONTEND_ORIGIN: process.env.BROWSER_TEST_FRONTEND_ORIGIN ?? "http://localhost:3000",
    PORT: process.env.BROWSER_TEST_API_PORT ?? "4000",
    MONGODB_URI: mongo.getUri("doctor_tracker_browser_tests"),
    LOGIN_IP_LIMIT: "100",
    LOGIN_ACCOUNT_LIMIT: "50",
  });
  await connectMongo({ logger, uri: config.MONGODB_URI });
  await Promise.all([
    AdminModel.syncIndexes(),
    SessionModel.syncIndexes(),
    DoctorModel.syncIndexes(),
    PatientModel.syncIndexes(),
  ]);
  await seedAdmin({
    SEED_ADMIN_EMAIL: "browser-test@example.test",
    SEED_ADMIN_NAME: "Browser Test Administrator",
    SEED_ADMIN_PASSWORD: "fictional-browser-verification-only",
  });
  const app = createApp({
    logger,
    isReady: checkMongoReadiness,
    registerRoutes: (expressApp) => {
      expressApp.use("/api/v1/auth", createAuthRouter(config));
      expressApp.use("/api/v1/dashboard", createDashboardRouter(config));
      expressApp.use("/api/v1/doctors/:doctorId/patients", createScopedPatientRouter(config));
      expressApp.use("/api/v1/doctors", createDoctorRouter(config));
      expressApp.use("/api/v1/patients", createPatientRouter(config));
    },
  });
  server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server!.once("error", reject);
    server!.listen(config.PORT, "127.0.0.1", resolve);
  });
  process.stdout.write(
    `Disposable authentication backend ready at http://127.0.0.1:${config.PORT}. Stop with Ctrl+C.\n`,
  );
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
} catch (error) {
  await stop();
  throw error;
}

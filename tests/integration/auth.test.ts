import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";
import { type AppConfig } from "../../src/config/env.js";
import { AdminModel } from "../../src/modules/auth/admin.model.js";
import { createAuthRouter } from "../../src/modules/auth/auth.routes.js";
import { LoginAttemptModel } from "../../src/modules/auth/login-attempt.model.js";
import { hashPassword, verifyPassword } from "../../src/modules/auth/password.js";
import { SessionModel } from "../../src/modules/auth/session.model.js";
import { hashSessionToken } from "../../src/modules/auth/session-token.js";
import { seedAdmin } from "../../src/scripts/seed-admin.js";
import { createRuntimeApp } from "../../src/runtime.js";
import { createTestLogger } from "../helpers/logger.js";

const config: AppConfig = Object.freeze({
  COOKIE_SECURE: false,
  FRONTEND_ORIGIN: "http://localhost:3000",
  HOST: "127.0.0.1",
  LOGIN_ACCOUNT_LIMIT: 20,
  LOGIN_IP_LIMIT: 50,
  API_RATE_LIMIT: 600,
  LOG_LEVEL: "silent",
  MONGODB_URI: "mongodb://unused/doctor_tracker",
  NODE_ENV: "test",
  PORT: 4000,
  SESSION_COOKIE_NAME: "doctor_tracker_session",
  SESSION_TTL_HOURS: 12,
  TRUST_PROXY_HOPS: 0,
});

let mongo: MongoMemoryServer;

function buildApp() {
  return createApp({
    logger: createTestLogger(),
    registerRoutes: (app) => app.use("/api/v1/auth", createAuthRouter(config)),
  });
}

async function createAdmin(overrides: { email?: string; status?: "active" | "disabled" } = {}) {
  return AdminModel.create({
    email: overrides.email ?? "admin@example.test",
    name: "Demo Administrator",
    passwordHash: await hashPassword("correct horse battery staple"),
    status: overrides.status ?? "active",
  });
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri("doctor_tracker"));
  await Promise.all([
    AdminModel.syncIndexes(),
    SessionModel.syncIndexes(),
    LoginAttemptModel.syncIndexes(),
  ]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all([
    AdminModel.deleteMany({}),
    SessionModel.deleteMany({}),
    LoginAttemptModel.deleteMany({}),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe("administrator authentication", () => {
  it("logs in without exposing credentials and resolves the current administrator", async () => {
    await createAdmin();
    const agent = request.agent(buildApp());
    const login = await agent
      .post("/api/v1/auth/login")
      .set("Origin", config.FRONTEND_ORIGIN)
      .set("User-Agent", "Doctor Tracker integration test")
      .send({ email: "  ADMIN@example.test ", password: "correct horse battery staple" })
      .expect(200);

    expect(login.body as unknown).toMatchObject({
      data: {
        email: "admin@example.test",
        name: "Demo Administrator",
        status: "active",
      },
    });
    expect(login.headers["cache-control"]).toBe("private, no-store");
    expect(JSON.stringify(login.body)).not.toMatch(/password|tokenHash|correct horse/i);
    const cookieHeader: unknown = login.headers["set-cookie"];
    const cookie = Array.isArray(cookieHeader) ? String(cookieHeader[0]) : undefined;
    expect(cookie).toContain("doctor_tracker_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/api/v1");

    const storedSession = await SessionModel.findOne().select("+tokenHash").lean().exec();
    expect(storedSession?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(cookie).not.toContain(storedSession?.tokenHash ?? "not-present");

    const current = await agent.get("/api/v1/auth/me").expect(200);
    expect(current.body as unknown).toMatchObject({ data: { email: "admin@example.test" } });
  });

  it("returns the same generic failure for wrong passwords and unknown accounts", async () => {
    await createAdmin();
    const app = buildApp();
    const wrong = await request(app)
      .post("/api/v1/auth/login")
      .set("Origin", config.FRONTEND_ORIGIN)
      .send({ email: "admin@example.test", password: "wrong password" })
      .expect(401);
    const unknown = await request(app)
      .post("/api/v1/auth/login")
      .set("Origin", config.FRONTEND_ORIGIN)
      .send({ email: "unknown@example.test", password: "wrong password" })
      .expect(401);

    expect(wrong.body as unknown).toMatchObject({
      error: {
        code: "INVALID_CREDENTIALS",
        message: "The email or password is incorrect.",
      },
    });
    expect(unknown.body as unknown).toMatchObject({
      error: {
        code: "INVALID_CREDENTIALS",
        message: "The email or password is incorrect.",
      },
    });
  });

  it("does not disclose that a configured administrator is disabled", async () => {
    await createAdmin({ status: "disabled" });
    const response = await request(buildApp())
      .post("/api/v1/auth/login")
      .set("Origin", config.FRONTEND_ORIGIN)
      .send({ email: "admin@example.test", password: "correct horse battery staple" })
      .expect(401);

    expect(response.body as unknown).toMatchObject({
      error: { code: "INVALID_CREDENTIALS", message: "The email or password is incorrect." },
    });
    expect(await SessionModel.countDocuments()).toBe(0);
  });

  it("rejects missing, random, expired, revoked, and disabled sessions", async () => {
    const admin = await createAdmin();
    const app = buildApp();
    await request(app).get("/api/v1/auth/me").expect(401);
    await request(app)
      .get("/api/v1/auth/me")
      .set("Cookie", "doctor_tracker_session=random")
      .expect(401);

    const expiredToken = "expired-token";
    await SessionModel.create({
      adminId: admin._id,
      expiresAt: new Date(Date.now() - 1_000),
      tokenHash: hashSessionToken(expiredToken),
    });
    await request(app)
      .get("/api/v1/auth/me")
      .set("Cookie", `doctor_tracker_session=${expiredToken}`)
      .expect(401);

    const revokedToken = "revoked-token";
    const revoked = await SessionModel.create({
      adminId: admin._id,
      expiresAt: new Date(Date.now() + 60_000),
      tokenHash: hashSessionToken(revokedToken),
    });
    await SessionModel.deleteOne({ _id: revoked._id });
    await request(app)
      .get("/api/v1/auth/me")
      .set("Cookie", `doctor_tracker_session=${revokedToken}`)
      .expect(401);

    const disabled = await createAdmin({ email: "disabled@example.test", status: "disabled" });
    const disabledToken = "disabled-token";
    await SessionModel.create({
      adminId: disabled._id,
      expiresAt: new Date(Date.now() + 60_000),
      tokenHash: hashSessionToken(disabledToken),
    });
    await request(app)
      .get("/api/v1/auth/me")
      .set("Cookie", `doctor_tracker_session=${disabledToken}`)
      .expect(401);
  });

  it("revokes the database session before clearing the cookie", async () => {
    await createAdmin();
    const agent = request.agent(buildApp());
    await agent
      .post("/api/v1/auth/login")
      .set("Origin", config.FRONTEND_ORIGIN)
      .send({ email: "admin@example.test", password: "correct horse battery staple" })
      .expect(200);
    expect(await SessionModel.countDocuments()).toBe(1);

    const logout = await agent
      .post("/api/v1/auth/logout")
      .set("Origin", config.FRONTEND_ORIGIN)
      .expect(204);
    expect(await SessionModel.countDocuments()).toBe(0);
    expect(logout.headers["set-cookie"]?.[0]).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
    await agent.get("/api/v1/auth/me").expect(401);
  });

  it("rejects unsafe requests from an untrusted browser origin", async () => {
    await request(buildApp())
      .post("/api/v1/auth/login")
      .set("Origin", "https://evil.example")
      .send({ email: "admin@example.test", password: "irrelevant" })
      .expect(403);
  });

  it("rate limits repeated attempts by normalized account key", async () => {
    const limitedConfig = { ...config, LOGIN_ACCOUNT_LIMIT: 1 };
    const app = createApp({
      logger: createTestLogger(),
      registerRoutes: (expressApp) =>
        expressApp.use("/api/v1/auth", createAuthRouter(limitedConfig)),
    });
    const attempt = () =>
      request(app)
        .post("/api/v1/auth/login")
        .set("Origin", config.FRONTEND_ORIGIN)
        .send({ email: "TARGET@example.test", password: "not the password" });

    await attempt().expect(401);
    const limited = await attempt().expect(429);
    expect(limited.body as unknown).toMatchObject({ error: { code: "RATE_LIMITED" } });
    expect(limited.headers["ratelimit-remaining"]).toBe("0");
  });

  it("shares atomic login limits across separate application instances", async () => {
    const limitedConfig = { ...config, LOGIN_ACCOUNT_LIMIT: 3 };
    const apps = [
      createRuntimeApp(limitedConfig, createTestLogger()),
      createRuntimeApp(limitedConfig, createTestLogger()),
    ];
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        request(apps[index % 2]!)
          .post("/api/v1/auth/login")
          .set("Origin", config.FRONTEND_ORIGIN)
          .send({ email: "SHARED@example.test", password: "fictional wrong password" }),
      ),
    );
    expect(responses.filter((response) => response.status === 401)).toHaveLength(3);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(5);
    for (const response of responses.filter((response) => response.status === 429))
      expect(Number(response.headers["retry-after"])).toBeGreaterThan(0);
    const counters = await LoginAttemptModel.find().lean();
    expect(counters).toHaveLength(2);
    expect(counters.every((counter) => /^[a-f0-9]{64}$/.test(counter._id))).toBe(true);
    expect(JSON.stringify(counters)).not.toContain("shared@example.test");
  });

  it("fails sign-in closed when its shared rate-limit store is unavailable", async () => {
    vi.spyOn(LoginAttemptModel, "findOneAndUpdate").mockImplementation(() => {
      throw new Error("Fictional database outage");
    });
    const response = await request(buildApp())
      .post("/api/v1/auth/login")
      .set("Origin", config.FRONTEND_ORIGIN)
      .send({ email: "admin@example.test", password: "fictional password" })
      .expect(503);
    expect(response.body as unknown).toMatchObject({ error: { code: "SERVICE_UNAVAILABLE" } });
    expect(await SessionModel.countDocuments()).toBe(0);
  });

  it("prepares the database for serverless requests without making liveness depend on it", async () => {
    const prepare = vi.fn().mockResolvedValue(undefined);
    const app = createRuntimeApp(config, createTestLogger(), prepare);
    await request(app).get("/health").expect(200);
    expect(prepare).not.toHaveBeenCalled();
    await request(app).get("/ready").expect(200);
    expect(prepare).toHaveBeenCalledTimes(1);
    await request(app).get("/api/v1/doctors").expect(401);
    expect(prepare).toHaveBeenCalledTimes(2);
    prepare.mockRejectedValueOnce(new Error("Fictional database outage"));
    const failure = await request(app).get("/api/v1/doctors").expect(503);
    expect(failure.body as unknown).toMatchObject({ error: { code: "SERVICE_UNAVAILABLE" } });
  });

  it("seeds one administrator idempotently and updates its configured credentials", async () => {
    const first = await seedAdmin({
      SEED_ADMIN_EMAIL: "seed@example.test",
      SEED_ADMIN_NAME: "First Name",
      SEED_ADMIN_PASSWORD: "a secure first password",
    });
    const second = await seedAdmin({
      SEED_ADMIN_EMAIL: "seed@example.test",
      SEED_ADMIN_NAME: "Updated Name",
      SEED_ADMIN_PASSWORD: "a secure second password",
    });
    expect(first).toBe("created");
    expect(second).toBe("updated");
    expect(await AdminModel.countDocuments()).toBe(1);
    const seeded = await AdminModel.findOne({ email: "seed@example.test" })
      .select("+passwordHash")
      .exec();
    expect(seeded?.name).toBe("Updated Name");
    await expect(
      verifyPassword(seeded?.passwordHash ?? "", "a secure second password"),
    ).resolves.toBe(true);
  });
});

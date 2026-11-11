import { Router } from "express";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AppError, createApp } from "../../src/app.js";
import { parseEnv } from "../../src/config/env.js";
import { createLogger } from "../../src/config/logger.js";
import { RequestLimitModel } from "../../src/common/http/request-limit.model.js";
import { apiRateLimit } from "../../src/common/middleware/api-rate-limit.js";
import { createRuntimeApp } from "../../src/runtime.js";
import { createTestLogger } from "../helpers/logger.js";

const origin = "https://portal.example.test";
const config = parseEnv({
  NODE_ENV: "test",
  FRONTEND_ORIGIN: origin,
  MONGODB_URI: "mongodb://unused/test",
  COOKIE_SECURE: "true",
  TRUST_PROXY_HOPS: "1",
  API_RATE_LIMIT: "3",
});
let mongo: MongoMemoryServer;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri("security_tests"));
  await RequestLimitModel.syncIndexes();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await RequestLimitModel.deleteMany({});
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

function app() {
  return createApp({
    logger: createTestLogger(),
    frontendOrigin: origin,
    secureTransport: true,
    registerRoutes: (server) => server.post("/api/v1/echo", (_req, res) => res.status(204).end()),
  });
}

describe("HTTP security boundary", () => {
  it("sets API security headers and no-store even on errors", async () => {
    for (const path of ["/health", "/missing"]) {
      const response = await request(app()).get(path);
      expect(response.headers["x-powered-by"]).toBeUndefined();
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
      expect(response.headers["x-frame-options"]).toBe("SAMEORIGIN");
      expect(response.headers["referrer-policy"]).toBe("no-referrer");
      expect(response.headers["strict-transport-security"]).toContain("max-age=31536000");
      expect(response.headers["content-security-policy"]).toContain("default-src 'none'");
      expect(response.headers["cache-control"]).toBe("private, no-store");
    }
    const local = await request(createApp({ logger: createTestLogger() })).get("/health");
    expect(local.headers["strict-transport-security"]).toBeUndefined();
  });

  it("permits only the exact origin and explicit CORS methods/headers", async () => {
    const allowed = await request(app())
      .options("/api/v1/echo")
      .set("Origin", origin)
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "Content-Type, X-Request-Id")
      .expect(204);
    expect(allowed.headers["access-control-allow-origin"]).toBe(origin);
    expect(allowed.headers["access-control-allow-credentials"]).toBe("true");
    expect(allowed.headers.vary).toContain("Origin");
    for (const untrusted of [
      "null",
      "https://portal.example.test.evil.test",
      "https://other.example.test",
    ]) {
      const denied = await request(app()).get("/api/v1/echo").set("Origin", untrusted).expect(403);
      expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
    }
    await request(app())
      .options("/api/v1/echo")
      .set("Origin", origin)
      .set("Access-Control-Request-Method", "PUT")
      .expect(403);
    await request(app())
      .options("/api/v1/echo")
      .set("Origin", origin)
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "Authorization")
      .expect(403);
  });

  it("rejects non-JSON, compressed, malformed, and oversized bodies with safe envelopes", async () => {
    await request(app()).post("/api/v1/echo").type("text").send("private body").expect(415);
    await request(app())
      .post("/api/v1/echo")
      .type("form")
      .send({ email: "fictional@example.test" })
      .expect(415);
    await request(app())
      .post("/api/v1/echo")
      .type("json")
      .set("Content-Encoding", "gzip")
      .send("{}")
      .expect(415);
    await request(app()).post("/api/v1/echo").type("json").send('{"secret":').expect(400);
    const large = await request(app())
      .post("/api/v1/echo")
      .send({ notes: "x".repeat(103_000) })
      .expect(413);
    expect(large.body as unknown).toMatchObject({
      error: { code: "VALIDATION_ERROR", message: "Request body is too large." },
    });
    await request(app()).post("/api/v1/echo").send({ message: "small body" }).expect(204);
    // Bodyless logout/delete remain legal; the route's own validation/auth still applies.
    await request(app()).post("/api/v1/echo").expect(204);
  });

  it("rejects mutation origins before database initialization, with no Referer fallback", async () => {
    const prepare = vi.fn().mockResolvedValue(undefined);
    const server = createRuntimeApp(
      { ...config, NODE_ENV: "production" },
      createTestLogger(),
      prepare,
    );
    await request(server)
      .post("/api/v1/auth/logout")
      .set("Referer", `${origin}/dashboard`)
      .expect(403);
    await request(server).post("/api/v1/auth/logout").set("Origin", "null").expect(403);
    expect(prepare).not.toHaveBeenCalled();
    await request(server)
      .options("/api/v1/auth/login")
      .set("Origin", origin)
      .set("Access-Control-Request-Method", "POST")
      .expect(204);
    expect(prepare).not.toHaveBeenCalled();
  });
});

describe("shared API request limits", () => {
  it("shares counters across app instances, honors one trusted hop, and excludes health", async () => {
    const first = createRuntimeApp(config, createTestLogger());
    const second = createRuntimeApp(config, createTestLogger());
    for (const server of [first, second, first])
      await request(server)
        .get("/api/v1/doctors")
        .set("X-Forwarded-For", "198.51.100.42")
        .expect(401);
    const limited = await request(second)
      .get("/api/v1/doctors")
      .set("X-Forwarded-For", "198.51.100.42")
      .expect(429);
    expect(limited.headers["ratelimit-remaining"]).toBe("0");
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    await request(second)
      .get("/api/v1/doctors")
      .set("X-Forwarded-For", "198.51.100.43")
      .expect(401);
    await request(second).get("/health").expect(200);
    const counters = await RequestLimitModel.find().lean();
    expect(counters).toHaveLength(2);
    expect(counters.every((entry) => /^[a-f0-9]{64}$/.test(entry._id))).toBe(true);
    expect(JSON.stringify(counters)).not.toContain("198.51.100");
    expect(
      (await RequestLimitModel.collection.indexes()).find(
        (index) => index.name === "request_limit_expiry_ttl",
      )?.expireAfterSeconds,
    ).toBe(0);
  });

  it("does not trust forged forwarded headers without proxy trust", async () => {
    const server = createRuntimeApp(
      { ...config, TRUST_PROXY_HOPS: 0, API_RATE_LIMIT: 1 },
      createTestLogger(),
    );
    await request(server)
      .get("/api/v1/doctors")
      .set("X-Forwarded-For", "198.51.100.42")
      .expect(401);
    await request(server)
      .get("/api/v1/doctors")
      .set("X-Forwarded-For", "198.51.100.43")
      .expect(429);
    expect(await RequestLimitModel.countDocuments()).toBe(1);
  });

  it("enforces a concurrent limit without retrying business actions", async () => {
    let actions = 0;
    const server = createApp({
      logger: createTestLogger(),
      registerRoutes: (router) => {
        router.use("/api/v1", apiRateLimit(4));
        router.post("/api/v1/action", (_req, res) => {
          actions++;
          res.status(204).end();
        });
      },
    });
    const results = await Promise.all(
      Array.from({ length: 12 }, () => request(server).post("/api/v1/action").send({})),
    );
    expect(results.filter((response) => response.status === 204)).toHaveLength(4);
    expect(results.filter((response) => response.status === 429)).toHaveLength(8);
    expect(actions).toBe(4);
  });

  it("fails closed with a safe 503 if the shared counter store fails", async () => {
    vi.spyOn(RequestLimitModel, "findOneAndUpdate").mockImplementationOnce(() => {
      throw new Error("database private detail");
    });
    const response = await request(createRuntimeApp(config, createTestLogger()))
      .get("/api/v1/doctors")
      .expect(503);
    expect(JSON.stringify(response.body)).not.toContain("database private detail");
  });
});

describe("privacy-safe production telemetry", () => {
  it("does not disclose internal AppError details even when marked operational by mistake", async () => {
    const server = createApp({
      logger: createTestLogger(),
      registerRoutes: (app) => {
        app.get("/internal", () => {
          throw new AppError({
            statusCode: 500,
            code: "PRIVATE_DATABASE_DETAIL",
            message: "private database message",
            fieldErrors: { notes: ["private notes"] },
          });
        });
      },
    });
    const response = await request(server).get("/internal").expect(500);
    expect(response.body as unknown).toMatchObject({
      error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." },
    });
    expect(JSON.stringify(response.body)).not.toMatch(
      /PRIVATE_DATABASE_DETAIL|private database message|private notes/,
    );
  });

  it("logs route templates and correlation once, never raw paths, input, headers, or error messages", async () => {
    let output = "";
    const logger = createLogger(
      { nodeEnv: "production", level: "info" },
      {
        write: (line) => {
          output += line;
        },
      },
    );
    const secret = "FictionalPrivateValue123";
    const server = createApp({
      logger,
      registerRoutes: (app) => {
        const router = Router({ mergeParams: true });
        router.post("/:patientId", (req) => {
          req.auth = {
            sessionId: "never-log-this-session",
            admin: {
              id: "admin-safe-id",
              email: "admin@example.test",
              name: "Private administrator",
              status: "active",
              createdAt: "2026-01-01T00:00:00Z",
              updatedAt: "2026-01-01T00:00:00Z",
              lastLoginAt: null,
            },
          };
          const failure = new Error(secret);
          failure.stack = `Error: ${secret}\n    at privateFunction (${process.cwd()}/src/runtime.ts:10:5)`;
          throw failure;
        });
        app.use("/api/v1/doctors/:doctorId/patients", router);
      },
    });
    const response = await request(server)
      .post(`/api/v1/doctors/${secret}/patients/${secret}?search=${secret}`)
      .set("X-Request-Id", "security-check-42")
      .set("Cookie", secret)
      .set("Authorization", secret)
      .send({ name: secret, notes: secret, email: `${secret}@example.test` })
      .expect(500);
    expect(response.body as unknown).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
        requestId: "security-check-42",
      },
    });
    expect(output).not.toContain(secret);
    expect(output).not.toContain("never-log-this-session");
    expect(output).not.toContain("admin@example.test");
    const entries = output
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(entries.filter((entry) => entry.msg === "Unhandled request error")).toHaveLength(1);
    expect(entries.find((entry) => entry.msg === "Unhandled request error")).toMatchObject({
      requestId: "security-check-42",
      errorType: "Error",
      stackFrames: [`${process.cwd()}/src/runtime.ts:10:5`],
    });
    expect(entries.find((entry) => entry.msg === "Request completed")).toMatchObject({
      method: "POST",
      route: "/api/v1/doctors/:doctorId/patients/:patientId",
      statusCode: 500,
      adminId: "admin-safe-id",
    });
    expect(typeof entries.find((entry) => entry.msg === "Request completed")?.durationMs).toBe(
      "number",
    );
    await request(server).get(`/${secret}?notes=${secret}`).expect(404);
    expect(output).not.toContain(secret);
    expect(output).toContain('"route":"unmatched"');
  });

  it("redacts defensive structured fields and sanitizes startup/fatal errors", () => {
    let output = "";
    const logger = createLogger(
      { nodeEnv: "production", level: "info" },
      {
        write: (line) => {
          output += line;
        },
      },
    );
    const secret = "PrivateExampleValue123";
    logger.error(
      {
        password: secret,
        token: secret,
        uri: secret,
        body: { notes: secret },
        req: { headers: { cookie: secret }, query: { search: secret } },
        err: new Error(secret),
      },
      "Safe constant message",
    );
    expect(output).not.toContain(secret);
    expect(output).toContain("[REDACTED]");
    expect(output).toContain('"errorType":"Error"');
  });
});

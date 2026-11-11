import { describe, expect, it } from "vitest";
import { EnvironmentConfigError, parseEnv, parseSeedEnv } from "../../src/config/env.js";

const validEnvironment: NodeJS.ProcessEnv = {
  COOKIE_SECURE: "false",
  FRONTEND_ORIGIN: "http://localhost:3000",
  LOG_LEVEL: "debug",
  MONGODB_URI: "mongodb://127.0.0.1:27017/doctor_tracker",
  NODE_ENV: "development",
  PORT: "4000",
  SESSION_COOKIE_NAME: "doctor_tracker_session",
  SESSION_TTL_HOURS: "12",
};

describe("environment configuration", () => {
  it("parses and freezes valid development configuration", () => {
    const config = parseEnv(validEnvironment);

    expect(config.PORT).toBe(4000);
    expect(config.COOKIE_SECURE).toBe(false);
    expect(config.FRONTEND_ORIGIN).toBe("http://localhost:3000");
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("rejects missing required values without echoing secret values", () => {
    expect(() => parseEnv({ NODE_ENV: "development" })).toThrow(EnvironmentConfigError);
  });

  it("rejects insecure production cookie and origins", () => {
    expect(() =>
      parseEnv({
        ...validEnvironment,
        COOKIE_SECURE: "false",
        FRONTEND_ORIGIN: "http://example.com",
        MONGODB_URI: "mongodb://database.example.com:27017/doctor_tracker",
        NODE_ENV: "production",
      }),
    ).toThrow(/COOKIE_SECURE must be true.*FRONTEND_ORIGIN must use HTTPS/);
  });

  it("rejects a local production database", () => {
    expect(() =>
      parseEnv({
        ...validEnvironment,
        COOKIE_SECURE: "true",
        FRONTEND_ORIGIN: "https://doctor-tracker.example",
        NODE_ENV: "production",
      }),
    ).toThrow(/MONGODB_URI must not target a local host/);
  });

  it("normalizes a trailing slash from the frontend origin", () => {
    const config = parseEnv({ ...validEnvironment, FRONTEND_ORIGIN: "http://localhost:3000/" });

    expect(config.FRONTEND_ORIGIN).toBe("http://localhost:3000");
  });

  it("validates and normalizes explicit administrator seed settings", () => {
    const seed = parseSeedEnv({
      SEED_ADMIN_EMAIL: "  ADMIN@Example.Test ",
      SEED_ADMIN_NAME: "Demo Administrator",
      SEED_ADMIN_PASSWORD: "a local password with sufficient length",
    });

    expect(seed.SEED_ADMIN_EMAIL).toBe("admin@example.test");
    expect(() => parseSeedEnv({ SEED_ADMIN_PASSWORD: "short" })).toThrow(EnvironmentConfigError);
  });
});

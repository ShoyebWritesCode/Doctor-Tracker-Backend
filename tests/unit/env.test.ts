import { describe, expect, it } from "vitest";
import { EnvironmentConfigError, parseEnv } from "../../src/config/env.js";

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
});

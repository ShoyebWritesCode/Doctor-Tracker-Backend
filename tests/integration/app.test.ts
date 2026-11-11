import type { Express } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { AppError, createApp } from "../../src/app.js";
import { createTestLogger } from "../helpers/logger.js";

function buildApp(registerRoutes?: (app: Express) => void) {
  return createApp({
    logger: createTestLogger(),
    ...(registerRoutes ? { registerRoutes } : {}),
  });
}

function getResponseRequestId(headers: Record<string, unknown>): string {
  const requestId = headers["x-request-id"];
  expect(typeof requestId).toBe("string");
  return requestId as string;
}

describe("application foundation", () => {
  it("reports process liveness without opening a network port", async () => {
    const response = await request(buildApp()).get("/health").expect(200);
    const requestId = getResponseRequestId(response.headers);

    expect(response.body).toEqual({ data: { status: "ok" } });
    expect(requestId).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it("preserves a trusted inbound request ID", async () => {
    const response = await request(buildApp())
      .get("/health")
      .set("X-Request-Id", "frontend-request-42")
      .expect(200);

    expect(getResponseRequestId(response.headers)).toBe("frontend-request-42");
  });

  it("replaces an unsafe inbound request ID", async () => {
    const response = await request(buildApp())
      .get("/health")
      .set("X-Request-Id", "unsafe request id")
      .expect(200);

    expect(getResponseRequestId(response.headers)).not.toBe("unsafe request id");
  });

  it("returns the standard envelope for unknown routes", async () => {
    const response = await request(buildApp()).get("/missing").expect(404);

    expect(response.body as unknown).toEqual({
      error: {
        code: "ROUTE_NOT_FOUND",
        message: "The requested API route does not exist.",
        requestId: getResponseRequestId(response.headers),
      },
    });
  });

  it("returns the standard envelope for operational errors", async () => {
    const app = buildApp((expressApp) => {
      expressApp.get("/test-error", (_request, _response, next) => {
        next(
          new AppError({
            code: "TEST_CONFLICT",
            message: "The test resource already exists.",
            statusCode: 409,
          }),
        );
      });
    });

    const response = await request(app).get("/test-error").expect(409);

    expect(response.body as unknown).toEqual({
      error: {
        code: "TEST_CONFLICT",
        message: "The test resource already exists.",
        requestId: getResponseRequestId(response.headers),
      },
    });
  });

  it("maps malformed JSON to a safe validation error", async () => {
    const app = buildApp((expressApp) => {
      expressApp.post("/echo", (_request, response) => {
        response.status(204).end();
      });
    });

    const response = await request(app)
      .post("/echo")
      .set("Content-Type", "application/json")
      .send('{"broken":')
      .expect(400);

    expect(response.body as unknown).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request body contains invalid JSON.",
      },
    });
  });
});

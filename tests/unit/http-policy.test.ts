import { get, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Request, Response, NextFunction } from "express";
import { describe, expect, it, vi } from "vitest";
import { createHttpServer, closeHttpServer } from "../../src/common/http/server-policy.js";
import { errorHandler } from "../../src/common/middleware/error-handler.js";
import { safeErrorDetails } from "../../src/common/http/safe-error.js";
import { parseEnv } from "../../src/config/env.js";
import {
  createDoctorSchema,
  doctorListSchema,
} from "../../src/modules/doctors/doctor.validation.js";
import {
  createPatientSchema,
  updatePatientSchema,
  patientListSchema,
} from "../../src/modules/patients/patient.validation.js";

describe("HTTP listener lifecycle", () => {
  it("bounds header/body/idle timeouts and header/socket resources", () => {
    const server = createHttpServer((_req, res) => res.end());
    expect(server.headersTimeout).toBe(10_000);
    expect(server.requestTimeout).toBe(30_000);
    expect(server.keepAliveTimeout).toBe(5_000);
    expect(server.timeout).toBe(30_000);
    expect(server.maxHeadersCount).toBe(64);
    expect(server.maxRequestsPerSocket).toBe(1000);
  });

  it("rejects oversized headers before the application handler runs", async () => {
    const handler = vi.fn((_req: IncomingMessage, res: ServerResponse) => res.end());
    const server = createHttpServer(handler);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const status = await new Promise<number | undefined>((resolve, reject) => {
        get(
          `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
          { headers: { "X-Oversized": "x".repeat(17 * 1024) } },
          (res) => {
            res.resume();
            resolve(res.statusCode);
          },
        ).on("error", reject);
      });
      expect(status).toBe(431);
      expect(handler).not.toHaveBeenCalled();
    } finally {
      await closeHttpServer(server);
    }
  });

  it("drains an in-flight request before closing the listener", async () => {
    let accepted: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      accepted = resolve;
    });
    const server = createHttpServer((_req, res) => {
      accepted();
      setTimeout(() => res.end("complete"), 25);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const response = new Promise<string>((resolve, reject) => {
        get(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, (res) => {
          let data = "";
          res.on("data", (chunk: Buffer) => {
            data += chunk.toString();
          });
          res.on("end", () => resolve(data));
          res.on("error", reject);
        }).on("error", reject);
      });
      await ready;
      await closeHttpServer(server);
      await expect(response).resolves.toBe("complete");
      expect(server.listening).toBe(false);
    } finally {
      server.closeAllConnections();
      if (server.listening) await closeHttpServer(server);
    }
  });

  it("forcibly closes a stalled request at the drain deadline", async () => {
    let accepted: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      accepted = resolve;
    });
    const server = createHttpServer(() => accepted());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const failed = new Promise<void>((resolve) => {
      get(`http://127.0.0.1:${(server.address() as AddressInfo).port}`).on("error", () =>
        resolve(),
      );
    });
    await ready;
    await expect(closeHttpServer(server, 25)).rejects.toThrow("HTTP drain deadline exceeded");
    await failed;
    expect(server.listening).toBe(false);
  });
});

describe("error and input safety", () => {
  it("closes a partial response without sending JSON or forwarding a raw error to Express stderr", () => {
    const next = vi.fn();
    const error = new Error("fictional late failure");
    const req = { log: { error: vi.fn() } };
    const res = {
      headersSent: true,
      status: vi.fn(),
      destroy: vi.fn(),
      getHeader: () => "late-error-42",
    };
    errorHandler(
      error,
      req as unknown as Request,
      res as unknown as Response,
      next as NextFunction,
    );
    expect(next).not.toHaveBeenCalled();
    expect(req.log.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(req.log.error.mock.calls)).not.toContain("fictional late failure");
    expect(res.destroy).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("drops arbitrary exception names, messages, causes, and non-source stack content", () => {
    const error = new Error("FictionalPrivateValue", { cause: new Error("PrivateCause") });
    error.name = "FictionalPrivateValue";
    error.stack = `Error: FictionalPrivateValue\n    at FictionalPrivateValue\n    at operation (${process.cwd()}/src/app.ts:20:10)\n    at private (/untrusted/PrivateCause:2:3)`;
    expect(safeErrorDetails(error)).toEqual({
      errorType: "UnknownError",
      stackFrames: [`${process.cwd()}/src/app.ts:20:10`],
    });
    expect(safeErrorDetails("PrivateCause")).toEqual({
      errorType: "UnknownError",
      stackFrames: [],
    });
  });

  it("rejects operator, prototype, and unknown query/body fields at strict schema boundaries", () => {
    const doctor = {
      name: "Fictional Doctor",
      specialization: "Cardiology",
      hospital: "Fictional Practice",
      email: "doctor@example.test",
      phone: "+1 202-555-0100",
    };
    const patient = {
      name: "Fictional Patient",
      condition: "Routine review",
      status: "active",
      phone: "+1 202-555-0101",
    };
    for (const unsafe of [
      JSON.parse('{"__proto__":{"polluted":true}}') as object,
      { $where: "return true" },
      { unexpected: "value" },
      { constructor: { prototype: { polluted: true } } },
    ]) {
      expect(createDoctorSchema.safeParse({ ...doctor, ...unsafe }).success).toBe(false);
      expect(createPatientSchema.safeParse({ ...patient, ...unsafe }).success).toBe(false);
      expect(updatePatientSchema.safeParse({ ...patient, ...unsafe }).success).toBe(false);
      expect(doctorListSchema.safeParse(unsafe).success).toBe(false);
      expect(patientListSchema.safeParse(unsafe).success).toBe(false);
    }
    expect(createDoctorSchema.safeParse({ ...doctor, email: { $ne: null } }).success).toBe(false);
    expect(doctorListSchema.safeParse({ "search[$ne]": "value" }).success).toBe(false);
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it("validates bounded API request limits without disclosing environment values", () => {
    const base = { MONGODB_URI: "mongodb://unused/test", FRONTEND_ORIGIN: "http://localhost:3000" };
    expect(parseEnv(base).API_RATE_LIMIT).toBe(600);
    for (const value of ["0", "10001", "-1", "not-a-number"])
      expect(() => parseEnv({ ...base, API_RATE_LIMIT: value })).toThrow();
  });
});

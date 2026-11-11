import { fileURLToPath } from "node:url";
import SwaggerParser from "@apidevtools/swagger-parser";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createRuntimeApp } from "../../src/runtime.js";
import { parseEnv } from "../../src/config/env.js";
import { openApiDocument } from "../../src/openapi.js";
import { seedAdmin } from "../../src/scripts/seed-admin.js";
import { createTestLogger } from "../helpers/logger.js";

const origin = "http://localhost:3000";
const app = createRuntimeApp(
  parseEnv({
    NODE_ENV: "test",
    MONGODB_URI: "mongodb://unused/contract-tests",
    FRONTEND_ORIGIN: origin,
  }),
  createTestLogger(),
);
const contract = z
  .object({ components: z.object({ schemas: z.record(z.string(), z.unknown()) }) })
  .parse(openApiDocument);
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats.default(ajv);
function matches(schema: string, value: unknown) {
  const validate = ajv.compile({
    $ref: `#/components/schemas/${schema}`,
    components: contract.components,
  });
  expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
}

let mongo: MongoMemoryReplSet;
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri("openapi_contract"));
  await seedAdmin({
    SEED_ADMIN_EMAIL: "contract@example.test",
    SEED_ADMIN_NAME: "Contract Administrator",
    SEED_ADMIN_PASSWORD: "fictional-contract-password",
  });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe("published OpenAPI contract", () => {
  it("validates the complete source without duplicate keys or unresolved references", async () => {
    const document = await SwaggerParser.validate(
      fileURLToPath(new URL("../../docs/openapi.yaml", import.meta.url)),
    );
    expect(document.info.version).toBe("1.0.0");
    expect(Object.keys(document.paths ?? {})).toHaveLength(13);
  });

  it("serves the source as read-only JSON without database access or an interactive explorer", async () => {
    const response = await request(app).get("/api-docs/openapi.json").expect(200);
    expect(response.body as unknown).toEqual(openApiDocument);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    await request(app).get("/api-docs").expect(404);
  });

  it("matches actual health, session, doctor, patient, analytics and error responses", async () => {
    matches("HealthResponse", (await request(app).get("/health").expect(200)).body as unknown);
    matches("ReadinessResponse", (await request(app).get("/ready").expect(200)).body as unknown);
    matches(
      "ErrorResponse",
      (await request(app).get("/api/v1/doctors").expect(401)).body as unknown,
    );
    const agent = request.agent(app);
    const login = await agent
      .post("/api/v1/auth/login")
      .set("Origin", origin)
      .send({ email: "contract@example.test", password: "fictional-contract-password" })
      .expect(200);
    matches("AdminResponse", login.body as unknown);
    const created = await agent
      .post("/api/v1/doctors")
      .set("Origin", origin)
      .send({
        name: "Dr. Fictional Contract",
        specialization: "Cardiology",
        hospital: "Fictional Practice",
        email: "doctor-contract@example.test",
        phone: "+880 1700 000000",
      })
      .expect(201);
    matches("DoctorResponse", created.body as unknown);
    const doctor = z.object({ data: z.object({ id: z.string() }) }).parse(created.body).data;
    const patient = await agent
      .post(`/api/v1/doctors/${doctor.id}/patients`)
      .set("Origin", origin)
      .send({
        name: "Fictional Contract Patient",
        condition: "Routine review",
        status: "active",
        phone: "+880 1700 111111",
      })
      .expect(201);
    matches("PatientResponse", patient.body as unknown);
    matches("DoctorListResponse", (await agent.get("/api/v1/doctors").expect(200)).body as unknown);
    matches(
      "PatientListResponse",
      (await agent.get("/api/v1/patients").expect(200)).body as unknown,
    );
    matches(
      "DashboardResponse",
      (
        await agent
          .get("/api/v1/dashboard/summary?from=2026-11-01&to=2026-12-01&timezone=Asia%2FDhaka")
          .expect(200)
      ).body as unknown,
    );
  });
});

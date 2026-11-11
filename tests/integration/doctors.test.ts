import type { Express } from "express";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../../src/app.js";
import { parseEnv } from "../../src/config/env.js";
import { AdminModel } from "../../src/modules/auth/admin.model.js";
import { SessionModel } from "../../src/modules/auth/session.model.js";
import { hashSessionToken } from "../../src/modules/auth/session-token.js";
import { DoctorModel } from "../../src/modules/doctors/doctor.model.js";
import { createDoctorRouter } from "../../src/modules/doctors/doctor.routes.js";
import { createTestLogger } from "../helpers/logger.js";

const config = parseEnv({
  NODE_ENV: "test",
  FRONTEND_ORIGIN: "http://localhost:3000",
  MONGODB_URI: "mongodb://unused/test",
});
const cookie = `${config.SESSION_COOKIE_NAME}=doctor-api-test-token`;
const input = {
  name: "Dr. Samira Khan",
  specialization: "Cardiology",
  hospital: "Central Hospital",
  phone: "+880 1700 000001",
  email: "samira@example.test",
};
const doctorDtoSchema = z.strictObject({
  id: z.string().regex(/^[a-f0-9]{24}$/),
  name: z.string(),
  specialization: z.string(),
  hospital: z.string(),
  phone: z.string(),
  email: z.email(),
  patientCount: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
const singleResponse = z.strictObject({ data: doctorDtoSchema });
const listResponse = z.strictObject({
  data: z.array(doctorDtoSchema),
  meta: z.strictObject({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});
let mongo: MongoMemoryServer | undefined;
let app: Express;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri("doctor_api_tests"));
  await Promise.all([
    AdminModel.syncIndexes(),
    SessionModel.syncIndexes(),
    DoctorModel.syncIndexes(),
  ]);
  const admin = await AdminModel.create({
    name: "Doctor API Tester",
    email: "tester@example.test",
    passwordHash: "unused-test-hash",
    status: "active",
  });
  await SessionModel.create({
    adminId: admin._id,
    tokenHash: hashSessionToken("doctor-api-test-token"),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  app = createApp({
    logger: createTestLogger(),
    registerRoutes: (expressApp) => expressApp.use("/api/v1/doctors", createDoctorRouter(config)),
  });
});
beforeEach(async () => {
  await DoctorModel.deleteMany({});
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

async function seedDoctor(
  index: number,
  overrides: Partial<typeof input> & { createdAt?: Date } = {},
) {
  return DoctorModel.create({
    ...input,
    name: `Dr. Test ${index}`,
    email: `doctor-${index}@example.test`,
    ...overrides,
  });
}

describe("doctor creation and authorization", () => {
  it("requires a valid session for create, list, and detail", async () => {
    await request(app).get("/api/v1/doctors").expect(401);
    await request(app).post("/api/v1/doctors").send(input).expect(401);
    await request(app).get(`/api/v1/doctors/${new Types.ObjectId().toHexString()}`).expect(401);
  });

  it("creates a normalized doctor with Location and an exact public DTO", async () => {
    const response = await request(app)
      .post("/api/v1/doctors")
      .set("Cookie", cookie)
      .set("Origin", config.FRONTEND_ORIGIN)
      .send({ ...input, name: "  Dr. Samira Khan  ", email: " SAMIRA@Example.Test " })
      .expect(201);
    const { data } = singleResponse.parse(response.body as unknown);
    expect(data).toMatchObject({ ...input, patientCount: 0 });
    expect(response.headers.location).toBe(`/api/v1/doctors/${data.id}`);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    const stored = await DoctorModel.findById(data.id)
      .select("+nameNormalized +hospitalNormalized +specializationNormalized")
      .lean()
      .exec();
    expect(stored).toMatchObject({
      nameNormalized: "dr. samira khan",
      hospitalNormalized: "central hospital",
      specializationNormalized: "cardiology",
    });
  });

  it("handles concurrent email conflicts through the unique index", async () => {
    const results = await Promise.all(
      ["SAMIRA@example.test", "samira@EXAMPLE.test"].map((email) =>
        request(app)
          .post("/api/v1/doctors")
          .set("Cookie", cookie)
          .send({ ...input, email }),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(results.find((result) => result.status === 409)?.body as unknown).toMatchObject({
      error: { code: "DOCTOR_EMAIL_CONFLICT" },
    });
    expect(await DoctorModel.countDocuments()).toBe(1);
  });

  it.each([
    { ...input, name: " " },
    { ...input, email: "invalid" },
    { ...input, phone: 12345678 },
    { ...input, hospital: "x" },
    { ...input, patientCount: 20 },
    { ...input, nameNormalized: "injected" },
    { ...input, specialization: { $ne: null } },
    { ...input, email: "x".repeat(255) },
  ])("rejects malformed or unknown creation fields %#", async (body) => {
    const response = await request(app)
      .post("/api/v1/doctors")
      .set("Cookie", cookie)
      .send(body)
      .expect(400);
    expect(response.body as unknown).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
    expect(await DoctorModel.countDocuments()).toBe(0);
  });

  it("rejects untrusted mutation origins", async () => {
    await request(app)
      .post("/api/v1/doctors")
      .set("Cookie", cookie)
      .set("Origin", "https://untrusted.example")
      .send(input)
      .expect(403);
    expect(await DoctorModel.countDocuments()).toBe(0);
  });
});

describe("doctor listing", () => {
  it("returns defaults and coherent empty metadata", async () => {
    const response = await request(app).get("/api/v1/doctors").set("Cookie", cookie).expect(200);
    expect(listResponse.parse(response.body as unknown)).toEqual({
      data: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
  });

  it.each([
    "page=0",
    "page=-1",
    "page=1.5",
    "page=1e2",
    "page=9007199254740991&limit=100",
    "limit=101",
    "limit=0",
    "sort=password:asc",
    "createdFrom=2026-02-30T00:00:00Z",
    "createdFrom=not-a-date",
    "createdFrom=2026-02-02T00:00:00Z&createdTo=2026-02-01T00:00:00Z",
    "search=",
    "page=1&page=2",
    "search[$ne]=x",
    "unexpected=true",
  ])("rejects invalid query %s", async (query) => {
    const response = await request(app)
      .get(`/api/v1/doctors?${query}`)
      .set("Cookie", cookie)
      .expect(400);
    expect(response.body as unknown).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });

  it.each(["createdAt:desc", "createdAt:asc", "name:asc", "name:desc"])(
    "paginates equal keys deterministically for %s",
    async (sort) => {
      const records = await Promise.all(
        Array.from({ length: 5 }, (_, index) =>
          seedDoctor(index, { name: "Same Name", createdAt: new Date("2026-01-01T00:00:00Z") }),
        ),
      );
      const expected = records.map((record) => record._id.toHexString()).sort();
      if (sort.endsWith(":desc")) expected.reverse();
      const ids: string[] = [];
      for (let page = 1; page <= 3; page++) {
        const response = await request(app)
          .get("/api/v1/doctors")
          .query({ sort, page, limit: 2 })
          .set("Cookie", cookie)
          .expect(200);
        const parsed = listResponse.parse(response.body as unknown);
        expect(parsed.meta).toEqual({ page, limit: 2, total: 5, totalPages: 3 });
        ids.push(...parsed.data.map((doctor) => doctor.id));
      }
      expect(ids).toEqual(expected);
    },
  );

  it("sorts names by normalized value rather than display casing", async () => {
    await seedDoctor(1, { name: "zara" });
    await seedDoctor(2, { name: "Anna" });
    const response = await request(app)
      .get("/api/v1/doctors?sort=name:asc")
      .set("Cookie", cookie)
      .expect(200);
    expect(listResponse.parse(response.body as unknown).data.map((doctor) => doctor.name)).toEqual([
      "Anna",
      "zara",
    ]);
  });

  it("filters and counts before pagination, normalizing exact filters", async () => {
    await seedDoctor(1, {
      specialization: "Cardiology",
      hospital: "Central   Hospital",
      createdAt: new Date("2026-02-01T00:00:00Z"),
    });
    await seedDoctor(2, {
      specialization: "Cardiology",
      createdAt: new Date("2026-02-02T00:00:00Z"),
    });
    await seedDoctor(3, { specialization: "Neurology" });
    const response = await request(app)
      .get("/api/v1/doctors")
      .query({
        specialization: "CARDIOLOGY",
        hospital: "central hospital",
        createdFrom: "2026-02-01T00:00:00Z",
        createdTo: "2026-02-02T00:00:00Z",
        limit: 1,
      })
      .set("Cookie", cookie)
      .expect(200);
    const parsed = listResponse.parse(response.body as unknown);
    expect(parsed.meta.total).toBe(1);
    expect(parsed.data[0]?.email).toBe("doctor-1@example.test");
  });

  it("searches name, email, and hospital by case-insensitive literal prefix", async () => {
    await seedDoctor(1, { name: "Dr. Prefix Example", hospital: "North Ward" });
    await seedDoctor(2, { email: "prefix@example.test" });
    await seedDoctor(3, { hospital: "Prefix Hospital" });
    await seedDoctor(4, { name: "Dr. Literal [test]" });
    for (const [search, expected] of [
      ["DR. PREFIX", 1],
      ["PREFIX", 2],
      ["dr. literal [", 1],
      [".*", 0],
      ["Ward", 0],
    ] as const) {
      const response = await request(app)
        .get("/api/v1/doctors")
        .query({ search })
        .set("Cookie", cookie)
        .expect(200);
      expect(listResponse.parse(response.body as unknown).meta.total).toBe(expected);
    }
  });

  it("supports the limit cap and pages beyond the result set", async () => {
    await seedDoctor(1);
    const response = await request(app)
      .get("/api/v1/doctors?page=2&limit=100")
      .set("Cookie", cookie)
      .expect(200);
    expect(listResponse.parse(response.body as unknown)).toEqual({
      data: [],
      meta: { page: 2, limit: 100, total: 1, totalPages: 1 },
    });
  });
});

describe("doctor details", () => {
  it("returns the same public representation as creation/listing", async () => {
    const record = await seedDoctor(1);
    const response = await request(app)
      .get(`/api/v1/doctors/${record._id.toHexString()}`)
      .set("Cookie", cookie)
      .expect(200);
    const { data } = singleResponse.parse(response.body as unknown);
    expect(data.id).toBe(record._id.toHexString());
    expect(data.patientCount).toBe(0);
  });
  it.each(["invalid", "123", "abcdefghijklmnopqrstuvwx"])("rejects malformed ID %s", async (id) => {
    await request(app).get(`/api/v1/doctors/${id}`).set("Cookie", cookie).expect(400);
  });
  it("returns a safe 404 for a valid missing ID", async () => {
    const response = await request(app)
      .get(`/api/v1/doctors/${new Types.ObjectId().toHexString()}`)
      .set("Cookie", cookie)
      .expect(404);
    expect(response.body as unknown).toMatchObject({ error: { code: "DOCTOR_NOT_FOUND" } });
  });
});

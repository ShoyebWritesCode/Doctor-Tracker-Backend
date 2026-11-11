import { Writable } from "node:stream";
import type { Express } from "express";
import mongoose, { Types } from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import pino from "pino";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createApp } from "../../src/app.js";
import { parseEnv } from "../../src/config/env.js";
import { AdminModel } from "../../src/modules/auth/admin.model.js";
import { SessionModel } from "../../src/modules/auth/session.model.js";
import { hashSessionToken } from "../../src/modules/auth/session-token.js";
import { DoctorModel } from "../../src/modules/doctors/doctor.model.js";
import { PatientModel } from "../../src/modules/patients/patient.model.js";
import {
  createPatientRouter,
  createScopedPatientRouter,
} from "../../src/modules/patients/patient.routes.js";
import { createPatient, updatePatient } from "../../src/modules/patients/patient.service.js";

const config = parseEnv({
  NODE_ENV: "test",
  FRONTEND_ORIGIN: "http://localhost:3000",
  MONGODB_URI: "mongodb://unused/test",
});
const cookie = `${config.SESSION_COOKIE_NAME}=patient-api-test-token`;
const input = {
  name: "Fictional Samira",
  email: "samira@example.test",
  condition: "Routine review",
  status: "active" as const,
};
const dtoSchema = z.strictObject({
  id: z.string().regex(/^[a-f0-9]{24}$/),
  doctor: z.strictObject({ id: z.string().regex(/^[a-f0-9]{24}$/), name: z.string() }),
  name: z.string(),
  email: z.email().nullable(),
  phone: z.string().nullable(),
  dateOfBirth: z.iso.date().nullable(),
  gender: z.enum(["female", "male", "non_binary", "prefer_not_to_say"]).nullable(),
  condition: z.string(),
  status: z.enum(["active", "follow_up", "discharged"]),
  lastVisitAt: z.iso.datetime().nullable(),
  notes: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
const responseSchema = z.strictObject({ data: dtoSchema });
const listSchema = z.strictObject({
  data: z.array(dtoSchema),
  meta: z.strictObject({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});
let mongo: MongoMemoryReplSet | undefined;
let app: Express;
let doctorA: string;
let doctorB: string;
let logs = "";

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri("patient_api_tests"));
  await Promise.all([
    AdminModel.syncIndexes(),
    SessionModel.syncIndexes(),
    DoctorModel.syncIndexes(),
    PatientModel.syncIndexes(),
  ]);
  const admin = await AdminModel.create({
    name: "Patient API Tester",
    email: "tester@example.test",
    passwordHash: "unused",
    status: "active",
  });
  await SessionModel.create({
    adminId: admin._id,
    tokenHash: hashSessionToken("patient-api-test-token"),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  const logger = pino(
    new Writable({
      write(chunk: Buffer, _encoding, callback) {
        logs += chunk.toString();
        callback();
      },
    }),
  );
  app = createApp({
    logger,
    registerRoutes: (expressApp) => {
      expressApp.use("/api/v1/doctors/:doctorId/patients", createScopedPatientRouter(config));
      expressApp.use("/api/v1/patients", createPatientRouter(config));
    },
  });
}, 30_000);

beforeEach(async () => {
  await PatientModel.deleteMany({});
  await DoctorModel.deleteMany({});
  const doctors = await DoctorModel.create([
    {
      name: "Dr. Fictional A",
      specialization: "Cardiology",
      hospital: "Demo Hospital",
      phone: "01700000001",
      email: "doctor-a@example.test",
    },
    {
      name: "Dr. Fictional B",
      specialization: "Neurology",
      hospital: "Demo Hospital",
      phone: "01700000002",
      email: "doctor-b@example.test",
    },
  ]);
  doctorA = doctors[0]!._id.toHexString();
  doctorB = doctors[1]!._id.toHexString();
  logs = "";
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

async function createViaApi(overrides: Record<string, unknown> = {}, doctorId = doctorA) {
  const response = await request(app)
    .post(`/api/v1/doctors/${doctorId}/patients`)
    .set("Cookie", cookie)
    .set("Origin", config.FRONTEND_ORIGIN)
    .send({ ...input, ...overrides })
    .expect(201);
  return { response, patient: responseSchema.parse(response.body as unknown).data };
}

async function assertCount(doctorId: string, expected: number) {
  const doctor = await DoctorModel.findById(doctorId).lean().exec();
  expect(doctor?.patientCount).toBe(expected);
  expect(await PatientModel.countDocuments({ doctorId })).toBe(expected);
}

describe("patient creation and scope", () => {
  it("creates a patient, returns only public fields, and increments exactly once", async () => {
    const { response, patient } = await createViaApi({
      email: " SAMIRA@Example.Test ",
      dateOfBirth: "2000-02-29",
      lastVisitAt: "2026-02-01T10:00:00+06:00",
    });
    expect(patient).toMatchObject({
      ...input,
      doctor: { id: doctorA, name: "Dr. Fictional A" },
      phone: null,
      gender: null,
      notes: null,
      dateOfBirth: "2000-02-29",
      lastVisitAt: "2026-02-01T04:00:00.000Z",
    });
    expect(response.headers.location).toBe(`/api/v1/patients/${patient.id}`);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    await assertCount(doctorA, 1);
    await assertCount(doctorB, 0);
  });

  it("accepts a phone as the sole contact", async () => {
    const body = {
      name: "Phone Contact",
      phone: "+880 (170) 000-0000",
      condition: "Review",
      status: "follow_up",
    };
    const response = await request(app)
      .post(`/api/v1/doctors/${doctorA}/patients`)
      .set("Cookie", cookie)
      .send(body)
      .expect(201);
    expect(responseSchema.parse(response.body as unknown).data.email).toBeNull();
    await assertCount(doctorA, 1);
  });

  it.each([
    { name: "No contact", condition: "Review", status: "active" },
    { ...input, name: " " },
    { ...input, doctorId: "injected" },
    { ...input, status: "unknown" },
    { ...input, gender: "unknown" },
    { ...input, dateOfBirth: "2001-02-29" },
    { ...input, dateOfBirth: "2000-01-01T00:00:00Z" },
    { ...input, lastVisitAt: "invalid" },
    { ...input, notes: "x".repeat(1001) },
    { ...input, email: null },
    { ...input, phone: 12345678 },
    { ...input, nameNormalized: "injected" },
    { ...input, condition: { $ne: null } },
  ])("rejects malformed and injected creation fields %#", async (body) => {
    const response = await request(app)
      .post(`/api/v1/doctors/${doctorA}/patients`)
      .set("Cookie", cookie)
      .send(body)
      .expect(400);
    expect(response.body as unknown).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    await assertCount(doctorA, 0);
  });

  it("checks doctor existence before creating or listing", async () => {
    const missing = new Types.ObjectId().toHexString();
    const created = await request(app)
      .post(`/api/v1/doctors/${missing}/patients`)
      .set("Cookie", cookie)
      .send(input)
      .expect(404);
    expect(created.body as unknown).toMatchObject({ error: { code: "DOCTOR_NOT_FOUND" } });
    await request(app).get(`/api/v1/doctors/${missing}/patients`).set("Cookie", cookie).expect(404);
    await request(app).get("/api/v1/doctors/invalid/patients").set("Cookie", cookie).expect(400);
    expect(await PatientModel.countDocuments()).toBe(0);
  });

  it("cannot expose another doctor's records through scoped queries", async () => {
    await createViaApi({}, doctorA);
    await createViaApi({ name: "Different Patient" }, doctorB);
    const response = await request(app)
      .get(`/api/v1/doctors/${doctorA}/patients`)
      .set("Cookie", cookie)
      .expect(200);
    const data = listSchema.parse(response.body as unknown);
    expect(data.meta.total).toBe(1);
    expect(data.data[0]?.doctor.id).toBe(doctorA);
    await request(app)
      .get(`/api/v1/doctors/${doctorA}/patients`)
      .query({ doctorId: doctorB })
      .set("Cookie", cookie)
      .expect(400);
  });

  it("requires authentication on all patient routes and trusted mutation origins", async () => {
    const id = new Types.ObjectId().toHexString();
    for (const path of [
      "/api/v1/patients",
      `/api/v1/patients/${id}`,
      `/api/v1/doctors/${doctorA}/patients`,
    ])
      await request(app).get(path).expect(401);
    await request(app).post(`/api/v1/doctors/${doctorA}/patients`).send(input).expect(401);
    await request(app).patch(`/api/v1/patients/${id}`).send({ name: "Changed" }).expect(401);
    await request(app).delete(`/api/v1/patients/${id}`).expect(401);
    await request(app).delete(`/api/v1/doctors/${doctorA}/patients/${id}`).expect(401);
    await request(app)
      .post(`/api/v1/doctors/${doctorA}/patients`)
      .set("Cookie", cookie)
      .set("Origin", "https://untrusted.example")
      .send(input)
      .expect(403);
  });
});

describe("patient query and detail", () => {
  it("returns empty default metadata and safely handles nonexistent global doctor filters", async () => {
    const response = await request(app).get("/api/v1/patients").set("Cookie", cookie).expect(200);
    expect(listSchema.parse(response.body as unknown)).toEqual({
      data: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
    const filtered = await request(app)
      .get("/api/v1/patients")
      .query({ doctorId: new Types.ObjectId().toHexString() })
      .set("Cookie", cookie)
      .expect(200);
    expect(listSchema.parse(filtered.body as unknown).meta.total).toBe(0);
  });

  it("supports combined global filters and totals before pagination", async () => {
    await createViaApi({ condition: "Routine   Review", status: "follow_up" });
    await createViaApi({ condition: "Other Condition" });
    await createViaApi({ condition: "Routine Review", status: "follow_up" }, doctorB);
    const response = await request(app)
      .get("/api/v1/patients")
      .query({
        doctorId: doctorA,
        condition: "ROUTINE REVIEW",
        status: "follow_up",
        createdFrom: "2000-01-01T00:00:00Z",
        createdTo: "2099-01-01T00:00:00Z",
        limit: 1,
      })
      .set("Cookie", cookie)
      .expect(200);
    const parsed = listSchema.parse(response.body as unknown);
    expect(parsed.meta).toEqual({ page: 1, limit: 1, total: 1, totalPages: 1 });
    expect(parsed.data[0]?.doctor).toEqual({ id: doctorA, name: "Dr. Fictional A" });
  });

  it("applies inclusive from and exclusive to timestamps", async () => {
    await PatientModel.create([
      { ...input, doctorId: doctorA, createdAt: new Date("2026-01-01T00:00:00Z") },
      { ...input, doctorId: doctorA, createdAt: new Date("2026-01-02T00:00:00Z") },
    ]);
    const response = await request(app)
      .get(`/api/v1/doctors/${doctorA}/patients`)
      .query({ createdFrom: "2026-01-01T00:00:00Z", createdTo: "2026-01-02T00:00:00Z" })
      .set("Cookie", cookie)
      .expect(200);
    expect(listSchema.parse(response.body as unknown).meta.total).toBe(1);
  });

  it("searches by literal normalized name, email, and formatted phone prefixes", async () => {
    await createViaApi({ name: "Literal [Demo]", phone: "+880 (170) 000-0000" });
    for (const search of ["literal [", "SAMIRA@", "+880170", "880 (170)"]) {
      const response = await request(app)
        .get("/api/v1/patients")
        .query({ search })
        .set("Cookie", cookie)
        .expect(200);
      expect(listSchema.parse(response.body as unknown).meta.total).toBe(1);
    }
    const literal = await request(app)
      .get("/api/v1/patients")
      .query({ search: ".*" })
      .set("Cookie", cookie)
      .expect(200);
    expect(listSchema.parse(literal.body as unknown).meta.total).toBe(0);
  });

  it.each([
    "page=0",
    "limit=101",
    "page=1.5",
    "page=1&page=2",
    "doctorId=bad",
    "status=unknown",
    "createdFrom=2026-02-30T00:00:00Z",
    "createdFrom=2026-02-02T00:00:00Z&createdTo=2026-02-01T00:00:00Z",
    "sort=notes:asc",
    "search[$ne]=null",
    "condition=",
    "extra=value",
  ])("rejects malformed list query %s", async (query) => {
    await request(app).get(`/api/v1/patients?${query}`).set("Cookie", cookie).expect(400);
  });

  it.each([
    "createdAt:asc",
    "createdAt:desc",
    "name:asc",
    "name:desc",
    "lastVisitAt:asc",
    "lastVisitAt:desc",
  ])("uses a deterministic ID tiebreaker for %s", async (sort) => {
    const patients = await PatientModel.create(
      Array.from({ length: 5 }, () => ({
        ...input,
        doctorId: doctorA,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        lastVisitAt: new Date("2026-01-01T00:00:00Z"),
      })),
    );
    const expected = patients.map((patient) => patient._id.toHexString()).sort();
    if (sort.endsWith(":desc")) expected.reverse();
    const ids: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const response = await request(app)
        .get("/api/v1/patients")
        .query({ page, limit: 2, sort })
        .set("Cookie", cookie)
        .expect(200);
      const parsed = listSchema.parse(response.body as unknown);
      expect(parsed.meta.total).toBe(5);
      ids.push(...parsed.data.map((patient) => patient.id));
    }
    expect(ids).toEqual(expected);
  });

  it("returns detail, a safe missing response, and rejects invalid IDs", async () => {
    const { patient } = await createViaApi();
    const detail = await request(app)
      .get(`/api/v1/patients/${patient.id}`)
      .set("Cookie", cookie)
      .expect(200);
    expect(responseSchema.parse(detail.body as unknown).data).toEqual(patient);
    await request(app).get("/api/v1/patients/invalid").set("Cookie", cookie).expect(400);
    const missing = await request(app)
      .get(`/api/v1/patients/${new Types.ObjectId().toHexString()}`)
      .set("Cookie", cookie)
      .expect(404);
    expect(missing.body as unknown).toMatchObject({ error: { code: "PATIENT_NOT_FOUND" } });
  });

  it("handles null last visits predictably and keeps out-of-range page metadata", async () => {
    const first = await createViaApi();
    const second = await createViaApi({
      name: "Visited Patient",
      lastVisitAt: "2026-01-01T00:00:00Z",
    });
    const response = await request(app)
      .get("/api/v1/patients")
      .query({ sort: "lastVisitAt:asc" })
      .set("Cookie", cookie)
      .expect(200);
    expect(listSchema.parse(response.body as unknown).data.map((patient) => patient.id)).toEqual([
      first.patient.id,
      second.patient.id,
    ]);
    const empty = await request(app)
      .get("/api/v1/patients")
      .query({ page: 2, limit: 100 })
      .set("Cookie", cookie)
      .expect(200);
    expect(listSchema.parse(empty.body as unknown)).toEqual({
      data: [],
      meta: { page: 2, limit: 100, total: 2, totalPages: 1 },
    });
  });
});

describe("patient updates and transaction consistency", () => {
  it("rejects stale update IDs and malformed mutation IDs", async () => {
    const id = new Types.ObjectId().toHexString();
    await request(app)
      .patch(`/api/v1/patients/${id}`)
      .set("Cookie", cookie)
      .send({ name: "Changed Name" })
      .expect(404);
    await request(app)
      .patch("/api/v1/patients/invalid")
      .set("Cookie", cookie)
      .send({ name: "Changed Name" })
      .expect(400);
    await request(app).delete("/api/v1/patients/invalid").set("Cookie", cookie).expect(400);
    await assertCount(doctorA, 0);
  });
  it("updates mutable fields, normalizes search keys and supports explicit nulls", async () => {
    const { patient } = await createViaApi({
      phone: "01700000000",
      notes: "Fictional note",
      dateOfBirth: "2000-01-01",
    });
    const response = await request(app)
      .patch(`/api/v1/patients/${patient.id}`)
      .set("Cookie", cookie)
      .send({
        name: "New Name",
        email: null,
        condition: "Updated Condition",
        notes: null,
        dateOfBirth: null,
        gender: "prefer_not_to_say",
        status: "discharged",
      })
      .expect(200);
    const updated = responseSchema.parse(response.body as unknown).data;
    expect(updated).toMatchObject({
      name: "New Name",
      email: null,
      notes: null,
      dateOfBirth: null,
      status: "discharged",
      doctor: patient.doctor,
    });
    const stored = await PatientModel.findById(patient.id)
      .select("+nameNormalized +conditionNormalized")
      .lean()
      .exec();
    expect(stored).toMatchObject({
      nameNormalized: "new name",
      conditionNormalized: "updated condition",
    });
    await assertCount(doctorA, 1);
  });

  it.each([
    {},
    { doctorId: "another-doctor" },
    { createdAt: "2000-01-01" },
    { _id: "injected" },
    { name: null },
    { email: null },
    { email: null, phone: null },
    { notes: "x".repeat(1001) },
    { dateOfBirth: "2026-02-30" },
    { $set: { name: "Injected" } },
  ])("rejects invalid, immutable or contact-removing patch %#", async (patch) => {
    const { patient } = await createViaApi();
    await request(app)
      .patch(`/api/v1/patients/${patient.id}`)
      .set("Cookie", cookie)
      .send(patch)
      .expect(400);
    const stored = await PatientModel.findById(patient.id).lean().exec();
    expect(stored?.email).toBe(input.email);
    await assertCount(doctorA, 1);
  });

  it("cannot delete a patient from a different doctor's scope", async () => {
    const { patient } = await createViaApi();
    await request(app)
      .delete(`/api/v1/doctors/${doctorB}/patients/${patient.id}`)
      .set("Cookie", cookie)
      .expect(404);
    await assertCount(doctorA, 1);
    await assertCount(doctorB, 0);
  });

  it.each(["scoped", "global"])(
    "deletes through the %s route, decrements once and rejects stale IDs",
    async (scope) => {
      const { patient } = await createViaApi();
      const path =
        scope === "scoped"
          ? `/api/v1/doctors/${doctorA}/patients/${patient.id}`
          : `/api/v1/patients/${patient.id}`;
      const deleted = await request(app).delete(path).set("Cookie", cookie).expect(204);
      expect(deleted.text).toBe("");
      await request(app).delete(path).set("Cookie", cookie).expect(404);
      await assertCount(doctorA, 0);
    },
  );

  it("rolls back the count if patient insertion fails and omits sensitive values from logs", async () => {
    const sensitive = "fictional-sensitive-note-that-must-not-be-logged";
    vi.spyOn(PatientModel, "create").mockRejectedValueOnce(new Error(sensitive));
    const response = await request(app)
      .post(`/api/v1/doctors/${doctorA}/patients`)
      .set("Cookie", cookie)
      .send({ ...input, notes: sensitive })
      .expect(500);
    expect(JSON.stringify(response.body)).not.toContain(sensitive);
    expect(logs).not.toContain(sensitive);
    expect(logs).not.toContain(input.email);
    await assertCount(doctorA, 0);
  });

  it("rolls back deletion when decrementing fails", async () => {
    const { patient } = await createViaApi();
    vi.spyOn(DoctorModel, "updateOne").mockImplementationOnce(() => {
      throw new Error("Simulated persistence failure");
    });
    await request(app).delete(`/api/v1/patients/${patient.id}`).set("Cookie", cookie).expect(500);
    expect(await PatientModel.exists({ _id: patient.id })).not.toBeNull();
    await assertCount(doctorA, 1);
  });

  it("refuses to go below zero and preserves the patient if an existing count is corrupt", async () => {
    const { patient } = await createViaApi();
    await DoctorModel.updateOne({ _id: doctorA }, { $set: { patientCount: 0 } });
    await request(app).delete(`/api/v1/patients/${patient.id}`).set("Cookie", cookie).expect(500);
    expect(await PatientModel.countDocuments({ _id: patient.id })).toBe(1);
    expect((await DoctorModel.findById(doctorA).lean().exec())?.patientCount).toBe(0);
  });

  it("keeps counts consistent after simultaneous creation and duplicate deletion requests", async () => {
    const created = await Promise.all(
      Array.from({ length: 6 }, () => createPatient(doctorA, input)),
    );
    await assertCount(doctorA, 6);
    const path = `/api/v1/patients/${created[0]!.id}`;
    const results = await Promise.all([
      request(app).delete(path).set("Cookie", cookie),
      request(app).delete(path).set("Cookie", cookie),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([204, 404]);
    await assertCount(doctorA, 5);
  });

  it("prevents concurrent updates from independently removing both contacts", async () => {
    const { patient } = await createViaApi({ phone: "01700000000" });
    const results = await Promise.allSettled([
      updatePatient(patient.id, { email: null }),
      updatePatient(patient.id, { phone: null }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(
      rejected?.status === "rejected" ? (rejected.reason as unknown) : undefined,
    ).toMatchObject({ code: "VALIDATION_ERROR", statusCode: 400 });
    const stored = await PatientModel.findById(patient.id).lean().exec();
    expect(Boolean(stored?.email || stored?.phone)).toBe(true);
    await assertCount(doctorA, 1);
  });
});

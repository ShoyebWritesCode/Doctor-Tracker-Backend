import type { Express } from "express";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
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
  createPatient,
  deletePatient,
  updatePatient,
} from "../../src/modules/patients/patient.service.js";
import { createDashboardRouter } from "../../src/modules/dashboard/dashboard.routes.js";
import { createTestLogger } from "../helpers/logger.js";

const config = parseEnv({
  NODE_ENV: "test",
  FRONTEND_ORIGIN: "http://localhost:3000",
  MONGODB_URI: "mongodb://unused/test",
});
const cookie = `${config.SESSION_COOKIE_NAME}=dashboard-api-test-token`;
const summarySchema = z.strictObject({
  data: z.strictObject({
    range: z.strictObject({ from: z.iso.date(), to: z.iso.date(), timezone: z.string() }),
    totals: z.strictObject({
      doctors: z.number().int().nonnegative(),
      patients: z.number().int().nonnegative(),
      patientsCreatedInRange: z.number().int().nonnegative(),
      averagePatientsPerDoctor: z.number().nonnegative(),
    }),
    patientsByDate: z.array(
      z.strictObject({ date: z.iso.date(), count: z.number().int().nonnegative() }),
    ),
    patientsByDoctor: z
      .array(
        z.strictObject({
          doctorId: z.string().regex(/^[a-f0-9]{24}$/),
          doctorName: z.string(),
          count: z.number().int().nonnegative(),
        }),
      )
      .max(10),
  }),
});
let mongo: MongoMemoryReplSet | undefined;
let app: Express;
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri("dashboard_api_tests"));
  await Promise.all([
    AdminModel.syncIndexes(),
    SessionModel.syncIndexes(),
    DoctorModel.syncIndexes(),
    PatientModel.syncIndexes(),
  ]);
  const admin = await AdminModel.create({
    name: "Dashboard API Tester",
    email: "dashboard@example.test",
    passwordHash: "unused",
    status: "active",
  });
  await SessionModel.create({
    adminId: admin._id,
    tokenHash: hashSessionToken("dashboard-api-test-token"),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  app = createApp({
    logger: createTestLogger(),
    registerRoutes: (expressApp) => {
      expressApp.use("/api/v1/dashboard", createDashboardRouter(config));
    },
  });
}, 30_000);
beforeEach(async () => {
  await PatientModel.deleteMany({});
  await DoctorModel.deleteMany({});
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

async function doctor(name = "Dr. Fictional", email = "doctor@example.test") {
  return DoctorModel.create({
    name,
    email,
    specialization: "Cardiology",
    hospital: "Demo Hospital",
    phone: "+880 1700 000000",
  });
}
async function patientAt(doctorId: string, at: string) {
  const patient = await createPatient(doctorId, {
    name: "Fictional Patient",
    phone: "+880 1700 111111",
    condition: "Routine review",
    status: "active",
  });
  // Historical test fixtures deliberately bypass Mongoose's immutable creation timestamp.
  await PatientModel.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(patient.id) },
    { $set: { createdAt: new Date(at) } },
  );
  return patient;
}
async function summary(query: Record<string, string> = { from: "2026-01-01", to: "2026-01-04" }) {
  const response = await request(app)
    .get("/api/v1/dashboard/summary")
    .set("Cookie", cookie)
    .query(query)
    .expect(200);
  expect(response.headers["cache-control"]).toBe("private, no-store");
  return summarySchema.parse(response.body as unknown).data;
}

describe("dashboard authentication and input boundary", () => {
  it("requires authentication before validating a query", async () => {
    await request(app).get("/api/v1/dashboard/summary").expect(401);
  });
  it.each([
    "",
    "?from=2026-01-01",
    "?from=2026-02-30&to=2026-03-02",
    "?from=2026-01-01T00:00:00Z&to=2026-01-02",
    "?from=2026-01-02&to=2026-01-01",
    "?from=2026-01-01&to=2026-01-01",
    "?from=2024-01-01&to=2025-01-02",
    "?from=2026-01-01&to=2026-01-02&timezone=Invalid/Zone",
    "?from=2026-01-01&to=2026-01-02&timezone=%2B06:00",
    "?from=2026-01-01&from=2026-01-02&to=2026-01-03",
    "?from=2026-01-01&to=2026-01-02&limit=1000",
    "?from[$gte]=2026-01-01&to=2026-01-02",
  ])("rejects invalid input %s", async (query) => {
    const response = await request(app)
      .get(`/api/v1/dashboard/summary${query}`)
      .set("Cookie", cookie)
      .expect(400);
    expect(response.body as unknown).toMatchObject({
      error: { code: "VALIDATION_ERROR", requestId: expect.any(String) as unknown },
    });
  });
  it("returns a safe error and request ID when an aggregate fails", async () => {
    vi.spyOn(PatientModel, "aggregate").mockImplementationOnce(() => {
      throw new Error("sensitive internal database detail");
    });
    const response = await request(app)
      .get("/api/v1/dashboard/summary")
      .set("Cookie", cookie)
      .query({ from: "2026-01-01", to: "2026-01-02" })
      .expect(500);
    expect(JSON.stringify(response.body)).not.toContain("sensitive internal");
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers["x-request-id"]).toBeDefined();
  });
});

describe("dashboard totals, series and rankings", () => {
  it("returns finite zero totals, zero-filled dates and no rankings for an empty database", async () => {
    const data = await summary();
    expect(data.range).toEqual({ from: "2026-01-01", to: "2026-01-04", timezone: "Asia/Dhaka" });
    expect(data.totals).toEqual({
      doctors: 0,
      patients: 0,
      patientsCreatedInRange: 0,
      averagePatientsPerDoctor: 0,
    });
    expect(data.patientsByDoctor).toEqual([]);
    expect(data.patientsByDate).toEqual([
      { date: "2026-01-01", count: 0 },
      { date: "2026-01-02", count: 0 },
      { date: "2026-01-03", count: 0 },
    ]);
  });
  it("includes zero-patient doctors and rounds an all-time average to two places", async () => {
    const a = await doctor("Dr. Alpha", "a@example.test");
    await doctor("Dr. Beta", "b@example.test");
    await doctor("Dr. Gamma", "c@example.test");
    await patientAt(a.id, "2020-01-01T00:00:00.000Z");
    const data = await summary();
    expect(data.totals).toEqual({
      doctors: 3,
      patients: 1,
      patientsCreatedInRange: 0,
      averagePatientsPerDoctor: 0.33,
    });
    expect(data.patientsByDoctor.map((row) => row.count)).toEqual([1, 0, 0]);
  });
  it("uses inclusive/exclusive Dhaka boundaries, fills gaps and reconciles source counts", async () => {
    const a = await doctor();
    for (const date of [
      "2025-12-31T17:59:59.999Z",
      "2025-12-31T18:00:00.000Z",
      "2026-01-01T17:59:59.999Z",
      "2026-01-02T18:00:00.000Z",
      "2026-01-03T17:59:59.999Z",
      "2026-01-03T18:00:00.000Z",
    ])
      await patientAt(a.id, date);
    const data = await summary();
    expect(data.totals).toEqual({
      doctors: 1,
      patients: 6,
      patientsCreatedInRange: 4,
      averagePatientsPerDoctor: 6,
    });
    expect(data.patientsByDate).toEqual([
      { date: "2026-01-01", count: 2 },
      { date: "2026-01-02", count: 0 },
      { date: "2026-01-03", count: 2 },
    ]);
    expect(data.totals.patientsCreatedInRange).toBe(
      await PatientModel.countDocuments({
        createdAt: {
          $gte: new Date("2025-12-31T18:00:00Z"),
          $lt: new Date("2026-01-03T18:00:00Z"),
        },
      }),
    );
    expect(data.totals.patients).toBe(await PatientModel.countDocuments({}));
    expect(data.patientsByDoctor[0]).toEqual({ doctorId: a.id, doctorName: a.name, count: 6 });
  });
  it("caps ranking at ten with name/ID ties and stable repeat requests", async () => {
    const doctors = [];
    for (let index = 11; index >= 0; index--)
      doctors.push(
        await doctor(
          index < 2 ? "Dr. A Same" : `Dr. Rank ${String(index).padStart(2, "0")}`,
          `rank-${index}@example.test`,
        ),
      );
    const leader = doctors[0]!;
    await patientAt(leader.id, "2026-01-01T00:00:00Z");
    const first = await summary();
    const expected = await DoctorModel.find({})
      .sort({ patientCount: -1, name: 1, _id: 1 })
      .limit(10)
      .lean()
      .exec();
    expect(first.patientsByDoctor.map((row) => row.doctorId)).toEqual(
      expected.map((row) => row._id.toHexString()),
    );
    expect(first.patientsByDoctor).toHaveLength(10);
    const tied = first.patientsByDoctor
      .filter((row) => row.doctorName === "Dr. A Same")
      .map((row) => row.doctorId);
    expect(tied).toHaveLength(2);
    expect(tied).toEqual([...tied].sort());
    expect(first.patientsByDoctor[0]?.doctorId).toBe(leader.id);
    expect((await summary()).patientsByDoctor).toEqual(first.patientsByDoctor);
  });
  it("reflects transactional create/delete immediately without a dashboard cache", async () => {
    const a = await doctor();
    const created = await patientAt(a.id, "2026-01-01T00:00:00Z");
    expect((await summary()).totals.patients).toBe(1);
    await updatePatient(created.id, { condition: "Aftercare", status: "follow_up" });
    expect((await summary()).totals.patientsCreatedInRange).toBe(1);
    await deletePatient(created.id);
    const result = await summary();
    expect(result.totals.patients).toBe(0);
    expect(result.totals.patientsCreatedInRange).toBe(0);
    expect(result.patientsByDoctor[0]?.count).toBe(0);
  });
  it.each([
    {
      from: "2026-03-08",
      to: "2026-03-09",
      timezone: "America/New_York",
      times: [
        "2026-03-08T04:59:59.999Z",
        "2026-03-08T05:00:00Z",
        "2026-03-08T06:59:59Z",
        "2026-03-08T07:00:00Z",
        "2026-03-09T03:59:59.999Z",
        "2026-03-09T04:00:00Z",
      ],
      count: 4,
    },
    {
      from: "2026-11-01",
      to: "2026-11-02",
      timezone: "America/New_York",
      times: [
        "2026-11-01T03:59:59.999Z",
        "2026-11-01T04:00:00Z",
        "2026-11-01T05:30:00Z",
        "2026-11-01T06:30:00Z",
        "2026-11-02T04:59:59.999Z",
        "2026-11-02T05:00:00Z",
      ],
      count: 4,
    },
    {
      from: "2018-11-04",
      to: "2018-11-05",
      timezone: "America/Sao_Paulo",
      times: [
        "2018-11-04T02:59:59.999Z",
        "2018-11-04T03:00:00Z",
        "2018-11-05T01:59:59.999Z",
        "2018-11-05T02:00:00Z",
      ],
      count: 2,
    },
  ])(
    "counts each instant exactly once on $timezone $from",
    async ({ from, to, timezone, times, count }) => {
      const a = await doctor();
      for (const at of times) await patientAt(a.id, at);
      const data = await summary({ from, to, timezone });
      expect(data.totals.patientsCreatedInRange).toBe(count);
      expect(data.patientsByDate).toEqual([{ date: from, count }]);
    },
  );
  it("fills leap day and a skipped dateline day without inventing records", async () => {
    const a = await doctor();
    await patientAt(a.id, "2011-12-30T09:59:59.999Z");
    await patientAt(a.id, "2011-12-30T10:00:00Z");
    const apia = await summary({ from: "2011-12-29", to: "2012-01-01", timezone: "Pacific/Apia" });
    expect(apia.patientsByDate).toEqual([
      { date: "2011-12-29", count: 1 },
      { date: "2011-12-30", count: 0 },
      { date: "2011-12-31", count: 1 },
    ]);
    const leap = await summary({ from: "2024-02-28", to: "2024-03-02", timezone: "UTC" });
    expect(leap.patientsByDate.map((row) => row.date)).toEqual([
      "2024-02-28",
      "2024-02-29",
      "2024-03-01",
    ]);
  });
});

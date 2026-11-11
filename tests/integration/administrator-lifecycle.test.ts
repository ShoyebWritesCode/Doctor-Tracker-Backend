import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseEnv } from "../../src/config/env.js";
import { createRuntimeApp } from "../../src/runtime.js";
import { AdminModel } from "../../src/modules/auth/admin.model.js";
import { SessionModel } from "../../src/modules/auth/session.model.js";
import { LoginAttemptModel } from "../../src/modules/auth/login-attempt.model.js";
import { RequestLimitModel } from "../../src/common/http/request-limit.model.js";
import { DoctorModel } from "../../src/modules/doctors/doctor.model.js";
import { PatientModel } from "../../src/modules/patients/patient.model.js";
import { seedAdmin } from "../../src/scripts/seed-admin.js";
import { seedDemoData } from "../../src/scripts/seed-demo.js";
import { createTestLogger } from "../helpers/logger.js";

const origin = "https://portal.example.test";
const config = parseEnv({
  NODE_ENV: "test",
  FRONTEND_ORIGIN: origin,
  MONGODB_URI: "mongodb://unused/test",
});
const app = createRuntimeApp(config, createTestLogger());
const account = {
  SEED_ADMIN_EMAIL: "lifecycle@example.test",
  SEED_ADMIN_NAME: "Fictional Administrator",
  SEED_ADMIN_PASSWORD: "fictional-lifecycle-password-only",
};
let mongo: MongoMemoryReplSet;
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri("administrator_lifecycle_tests"));
  await Promise.all([
    AdminModel.syncIndexes(),
    SessionModel.syncIndexes(),
    LoginAttemptModel.syncIndexes(),
    RequestLimitModel.syncIndexes(),
    DoctorModel.syncIndexes(),
    PatientModel.syncIndexes(),
  ]);
}, 30_000);
beforeEach(async () => {
  await Promise.all([
    AdminModel.deleteMany({}),
    SessionModel.deleteMany({}),
    LoginAttemptModel.deleteMany({}),
    RequestLimitModel.deleteMany({}),
    DoctorModel.deleteMany({}),
    PatientModel.deleteMany({}),
  ]);
  await seedAdmin(account);
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

async function signIn() {
  const response = await request(app)
    .post("/api/v1/auth/login")
    .set("Origin", origin)
    .send({ email: account.SEED_ADMIN_EMAIL, password: account.SEED_ADMIN_PASSWORD })
    .expect(200);
  const cookies: unknown = response.headers["set-cookie"];
  expect(Array.isArray(cookies)).toBe(true);
  if (!Array.isArray(cookies) || typeof cookies[0] !== "string")
    throw new Error("Missing fixture cookie");
  expect(cookies[0]).toContain("HttpOnly");
  expect(cookies[0]).toContain("SameSite=Lax");
  expect(cookies[0]).toContain("Path=/api/v1");
  return cookies[0].split(";", 1)[0]!;
}

describe("complete administrator workflow through the production router composition", () => {
  it("authenticates, creates doctors/patient, filters, edits, protects ownership, reconciles counts, deletes and logs out", async () => {
    await request(app).get("/api/v1/patients").expect(401);
    const cookie = await signIn();
    const agent = request.agent(app);
    const doctorInput = {
      name: "Dr Fictional Lifecycle",
      specialization: "Cardiology",
      hospital: "Fictional Practice",
      email: "lifecycle-doctor@example.test",
      phone: "+1 202-555-0100",
    };
    const doctor = await agent
      .post("/api/v1/doctors")
      .set("Origin", origin)
      .set("Cookie", cookie)
      .send(doctorInput)
      .expect(201);
    const doctorId = String((doctor.body as { data: { id: string } }).data.id);
    await agent
      .post("/api/v1/doctors")
      .set("Origin", origin)
      .set("Cookie", cookie)
      .send(doctorInput)
      .expect(409);
    const other = await agent
      .post("/api/v1/doctors")
      .set("Origin", origin)
      .set("Cookie", cookie)
      .send({ ...doctorInput, email: "other-lifecycle@example.test" })
      .expect(201);
    const otherId = (other.body as { data: { id: string } }).data.id;
    const created = await agent
      .post(`/api/v1/doctors/${doctorId}/patients`)
      .set("Origin", origin)
      .set("Cookie", cookie)
      .send({
        name: "Fictional Workflow Patient",
        condition: "Routine review",
        status: "active",
        email: "workflow-patient@example.test",
      })
      .expect(201);
    const patientId = (created.body as { data: { id: string } }).data.id;
    await agent
      .get("/api/v1/patients?search=fictional%20workflow&status=active")
      .set("Cookie", cookie)
      .expect(200)
      .expect((response) => {
        expect(response.body as unknown).toMatchObject({
          data: [{ id: patientId, doctor: { id: doctorId } }],
          meta: { total: 1 },
        });
      });
    await agent
      .patch(`/api/v1/patients/${patientId}`)
      .set("Origin", origin)
      .set("Cookie", cookie)
      .send({ status: "follow_up", phone: "+1 202-555-0101", email: null })
      .expect(200);
    await agent
      .get("/api/v1/patients?status=follow_up")
      .set("Cookie", cookie)
      .expect(200)
      .expect((response) => {
        expect(response.body as unknown).toMatchObject({
          data: [{ id: patientId, email: null, status: "follow_up" }],
          meta: { total: 1 },
        });
      });
    await agent
      .delete(`/api/v1/doctors/${otherId}/patients/${patientId}`)
      .set("Origin", origin)
      .set("Cookie", cookie)
      .expect(404);
    const summaryPath = "/api/v1/dashboard/summary?from=2020-01-01&to=2020-01-02&timezone=UTC";
    await agent
      .get(summaryPath)
      .set("Cookie", cookie)
      .expect(200)
      .expect((response) => {
        expect(response.body as unknown).toMatchObject({
          data: {
            totals: { doctors: 2, patients: 1, averagePatientsPerDoctor: 0.5 },
            patientsByDate: [{ date: "2020-01-01", count: 0 }],
          },
        });
      });
    await agent
      .get(`/api/v1/doctors/${doctorId}`)
      .set("Cookie", cookie)
      .expect(200)
      .expect((response) => {
        expect(response.body as unknown).toMatchObject({ data: { patientCount: 1 } });
      });
    await agent
      .delete(`/api/v1/patients/${patientId}`)
      .set("Origin", origin)
      .set("Cookie", cookie)
      .expect(204);
    await agent
      .delete(`/api/v1/patients/${patientId}`)
      .set("Origin", origin)
      .set("Cookie", cookie)
      .expect(404);
    expect(await PatientModel.countDocuments()).toBe(0);
    expect((await DoctorModel.findById(doctorId).lean())?.patientCount).toBe(0);
    await agent
      .get(summaryPath)
      .set("Cookie", cookie)
      .expect(200)
      .expect((response) => {
        expect(response.body as unknown).toMatchObject({
          data: { totals: { doctors: 2, patients: 0, averagePatientsPerDoctor: 0 } },
        });
      });
    await agent.post("/api/v1/auth/logout").set("Origin", origin).set("Cookie", cookie).expect(204);
    await agent.get("/api/v1/auth/me").set("Cookie", cookie).expect(401);
    await agent.get("/api/v1/patients").set("Cookie", cookie).expect(401);
    expect(await SessionModel.countDocuments()).toBe(0);
  });

  it("reconciles the complete fictional seed with lists, status filters, rankings and daily totals", async () => {
    await seedDemoData({ apply: true, now: new Date("2026-11-11T12:00:00Z") });
    const cookie = await signIn();
    const doctors = await request(app)
      .get("/api/v1/doctors?limit=100")
      .set("Cookie", cookie)
      .expect(200);
    const patients = await request(app)
      .get("/api/v1/patients?limit=100")
      .set("Cookie", cookie)
      .expect(200);
    expect((doctors.body as { meta: { total: number } }).meta.total).toBe(
      await DoctorModel.countDocuments(),
    );
    expect((patients.body as { meta: { total: number } }).meta.total).toBe(256);
    let statusTotal = 0;
    for (const status of ["active", "follow_up", "discharged"]) {
      const result = await request(app)
        .get(`/api/v1/patients?status=${status}&limit=1`)
        .set("Cookie", cookie)
        .expect(200);
      statusTotal += (result.body as { meta: { total: number } }).meta.total;
    }
    expect(statusTotal).toBe(256);
    const response = await request(app)
      .get("/api/v1/dashboard/summary?from=2026-08-01&to=2026-11-12&timezone=Asia%2FDhaka")
      .set("Cookie", cookie)
      .expect(200);
    const summary = (
      response.body as {
        data: {
          totals: { doctors: number; patients: number; patientsCreatedInRange: number };
          patientsByDate: { count: number }[];
          patientsByDoctor: { doctorId: string; count: number }[];
        };
      }
    ).data;
    expect(summary.totals.doctors).toBe((doctors.body as { meta: { total: number } }).meta.total);
    expect(summary.totals.patients).toBe(statusTotal);
    expect(summary.totals.patientsCreatedInRange).toBe(256);
    expect(summary.patientsByDate.reduce((sum, point) => sum + point.count, 0)).toBe(256);
    for (const entry of summary.patientsByDoctor)
      expect(entry.count).toBe(await PatientModel.countDocuments({ doctorId: entry.doctorId }));
    await request(app)
      .post("/api/v1/auth/logout")
      .set("Origin", origin)
      .set("Cookie", cookie)
      .expect(204);
  });
});

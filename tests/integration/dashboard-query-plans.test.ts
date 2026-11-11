import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { DoctorModel } from "../../src/modules/doctors/doctor.model.js";
import { PatientModel } from "../../src/modules/patients/patient.model.js";
import {
  doctorRankingProjection,
  doctorRankingSort,
  patientTrendPipeline,
} from "../../src/modules/dashboard/dashboard.service.js";

let mongo: MongoMemoryServer | undefined;
const doctorIds = Array.from({ length: 2000 }, () => new mongoose.Types.ObjectId());
const explainSchema = z.object({
  executionStats: z.object({
    nReturned: z.number(),
    totalDocsExamined: z.number(),
    totalKeysExamined: z.number(),
  }),
  queryPlanner: z.object({ winningPlan: z.unknown() }),
});
function cursorPlan(value: unknown): z.infer<typeof explainSchema> {
  const direct = explainSchema.safeParse(value);
  if (direct.success) return direct.data;
  const aggregate = z.object({ stages: z.array(z.record(z.string(), z.unknown())) }).parse(value);
  return explainSchema.parse(aggregate.stages.find((stage) => "$cursor" in stage)?.$cursor);
}
function planValues(value: unknown, key: string): string[] {
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([name, child]) =>
    name === key && typeof child === "string" ? [child] : planValues(child, key),
  );
}
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri("dashboard_query_plans"));
  await Promise.all([DoctorModel.syncIndexes(), PatientModel.syncIndexes()]);
  await DoctorModel.insertMany(
    doctorIds.map((_id, index) => ({
      _id,
      name: `Fixture Doctor ${String(index).padStart(4, "0")}`,
      email: `doctor-${index}@example.test`,
      phone: "+880 1700 000000",
      hospital: "Fictional Hospital",
      specialization: "Cardiology",
      patientCount: index < 100 ? 20 : 0,
    })),
  );
  await PatientModel.insertMany(
    Array.from({ length: 2000 }, (_, index) => ({
      doctorId: doctorIds[index % 100],
      name: `Fictional Patient ${index}`,
      phone: "+880 1700 111111",
      condition: "Routine review",
      status: "active",
      createdAt: new Date(Date.UTC(2026, 0, 1, index)),
    })),
  );
}, 30_000);
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

describe("dashboard index hypotheses on 2000 doctors and patients", () => {
  it("starts the patient trend with bounded indexed access instead of grouping the full collection", async () => {
    const pipeline = patientTrendPipeline(
      new Date("2026-02-01T00:00:00Z"),
      new Date("2026-02-03T00:00:00Z"),
      "UTC",
    );
    expect(pipeline[0]).toHaveProperty("$match.createdAt");
    const explanation: unknown = await PatientModel.aggregate(pipeline).explain("executionStats");
    const plan = cursorPlan(explanation);
    expect(planValues(plan.queryPlanner.winningPlan, "indexName")).toContain("patient_created");
    expect(plan.executionStats.totalKeysExamined).toBeLessThanOrEqual(49);
    expect(plan.executionStats.totalDocsExamined).toBeLessThanOrEqual(48);
    expect(await PatientModel.aggregate(pipeline)).toEqual([
      { count: 24, date: "2026-02-01" },
      { count: 24, date: "2026-02-02" },
    ]);
    process.stdout.write(
      `${JSON.stringify({ query: "dashboard date range", ...plan.executionStats })}\n`,
    );
  });
  it("justifies the ranking index with measured before/after work and no blocking indexed sort", async () => {
    // This is an isolated disposable fixture; no application/deployment indexes are dropped.
    await DoctorModel.collection.dropIndex("doctor_patient_ranking");
    const baseline: unknown = await DoctorModel.find({})
      .select(doctorRankingProjection)
      .sort(doctorRankingSort)
      .limit(10)
      .explain("executionStats");
    const before = cursorPlan(baseline);
    expect(before.executionStats.totalDocsExamined).toBe(2000);
    expect(planValues(before.queryPlanner.winningPlan, "stage")).toContain("SORT");
    await DoctorModel.collection.createIndex(
      { patientCount: -1, name: 1, _id: 1 },
      { name: "doctor_patient_ranking" },
    );
    const explanation: unknown = await DoctorModel.find({})
      .select(doctorRankingProjection)
      .sort(doctorRankingSort)
      .limit(10)
      .explain("executionStats");
    const after = cursorPlan(explanation);
    expect(planValues(after.queryPlanner.winningPlan, "indexName")).toContain(
      "doctor_patient_ranking",
    );
    expect(planValues(after.queryPlanner.winningPlan, "stage")).not.toContain("SORT");
    expect(after.executionStats.nReturned).toBe(10);
    expect(after.executionStats.totalKeysExamined).toBeLessThanOrEqual(10);
    expect(after.executionStats.totalDocsExamined).toBeLessThanOrEqual(10);
    process.stdout.write(
      `${JSON.stringify({ query: "dashboard ranking", before: before.executionStats, after: after.executionStats })}\n`,
    );
  });
});

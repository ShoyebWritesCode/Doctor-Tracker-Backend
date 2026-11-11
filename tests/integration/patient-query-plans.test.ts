import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { PatientModel, patientProjection } from "../../src/modules/patients/patient.model.js";
import {
  buildPatientFilter,
  buildPatientSort,
} from "../../src/modules/patients/patient.service.js";
import { patientListSchema } from "../../src/modules/patients/patient.validation.js";

let mongo: MongoMemoryServer | undefined;
const doctorIds = Array.from({ length: 10 }, () => new mongoose.Types.ObjectId());
const explanationSchema = z.object({
  executionStats: z.object({
    nReturned: z.number(),
    totalDocsExamined: z.number(),
    totalKeysExamined: z.number(),
  }),
  queryPlanner: z.object({ winningPlan: z.unknown() }),
});

function indexNames(plan: unknown): string[] {
  if (typeof plan !== "object" || plan === null) return [];
  const names: string[] = [];
  for (const [key, value] of Object.entries(plan)) {
    if (key === "indexName" && typeof value === "string") names.push(value);
    else if (Array.isArray(value)) names.push(...value.flatMap(indexNames));
    else if (typeof value === "object") names.push(...indexNames(value));
  }
  return [...new Set(names)];
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri("patient_query_plans"));
  await PatientModel.syncIndexes();
  await PatientModel.insertMany(
    Array.from({ length: 2000 }, (_, index) => ({
      doctorId: doctorIds[index % doctorIds.length],
      name: index % 100 === 0 ? `Target Patient ${index}` : `Fictional Patient ${index}`,
      email: index % 100 === 0 ? `target-${index}@example.test` : `patient-${index}@example.test`,
      phone: `017${String(index).padStart(8, "0")}`,
      condition: `Condition ${index % 20}`,
      status: ["active", "follow_up", "discharged"][index % 3],
      lastVisitAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
    })),
  );
}, 30_000);
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

describe("patient index hypotheses on 2000 fictional records", () => {
  it.each([
    { name: "default", input: {}, expected: ["patient_created"], maxDocs: 20 },
    {
      name: "doctor",
      input: { doctorId: doctorIds[0]!.toHexString() },
      expected: ["patient_doctor_created"],
      maxDocs: 20,
    },
    {
      name: "condition",
      input: { condition: "Condition 3" },
      expected: ["patient_condition_created"],
      maxDocs: 20,
    },
    {
      name: "status",
      input: { status: "follow_up" },
      expected: ["patient_status_created"],
      maxDocs: 20,
    },
    {
      name: "doctor and condition",
      input: { doctorId: doctorIds[3]!.toHexString(), condition: "Condition 3" },
      expected: ["patient_doctor_created", "patient_condition_created"],
      maxDocs: 100,
    },
    { name: "name sort", input: { sort: "name:asc" }, expected: ["patient_name"], maxDocs: 20 },
    {
      name: "last visit sort",
      input: { sort: "lastVisitAt:desc" },
      expected: ["patient_last_visit"],
      maxDocs: 20,
    },
    {
      name: "search",
      input: { search: "target" },
      expected: ["patient_name", "patient_email_prefix", "patient_phone_prefix"],
      maxDocs: 100,
    },
  ])("uses bounded indexed access for $name", async ({ name, input, expected, maxDocs }) => {
    const query = patientListSchema.parse(input);
    const explanation: unknown = await PatientModel.find(buildPatientFilter(query))
      .select(patientProjection)
      .sort(buildPatientSort(query))
      .limit(query.limit)
      .explain("executionStats");
    const parsed = explanationSchema.parse(explanation);
    const indexes = indexNames(parsed.queryPlanner.winningPlan);
    expect(indexes.some((index) => expected.includes(index))).toBe(true);
    expect(parsed.executionStats.nReturned).toBe(20);
    expect(parsed.executionStats.totalDocsExamined).toBeLessThanOrEqual(maxDocs);
    process.stdout.write(
      `${JSON.stringify({ query: `patient ${name}`, indexes, ...parsed.executionStats })}\n`,
    );
  });
});

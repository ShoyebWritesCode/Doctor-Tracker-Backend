import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { DoctorModel, doctorProjection } from "../../src/modules/doctors/doctor.model.js";
import { buildDoctorFilter, buildDoctorSort } from "../../src/modules/doctors/doctor.service.js";
import { doctorListSchema } from "../../src/modules/doctors/doctor.validation.js";

let mongo: MongoMemoryServer | undefined;
const explainSchema = z.object({
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
  await mongoose.connect(mongo.getUri("doctor_query_plans"));
  await DoctorModel.syncIndexes();
  await DoctorModel.insertMany(
    Array.from({ length: 2_000 }, (_, index) => ({
      name: index % 100 === 0 ? `Target Doctor ${index}` : `Doctor Fixture ${index}`,
      specialization: `Specialty ${index % 10}`,
      hospital: `Hospital ${index % 40}`,
      email: index % 100 === 0 ? `target-${index}@example.test` : `fixture-${index}@example.test`,
      phone: "+880 1700 000000",
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
    })),
  );
}, 30_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

describe("doctor index hypotheses on 2000 fictional records", () => {
  it.each([
    { name: "default", input: {}, expected: ["doctor_created"], maxDocs: 20 },
    {
      name: "specialization",
      input: { specialization: "Specialty 3" },
      expected: ["doctor_specialization_created"],
      maxDocs: 20,
    },
    {
      name: "hospital",
      input: { hospital: "Hospital 3" },
      expected: ["doctor_hospital_created"],
      maxDocs: 20,
    },
    {
      name: "combined",
      input: { specialization: "Specialty 3", hospital: "Hospital 3" },
      expected: ["doctor_hospital_created", "doctor_specialization_created"],
      maxDocs: 200,
    },
    {
      name: "search",
      input: { search: "target" },
      expected: ["doctor_name", "doctor_email_unique", "doctor_hospital_created"],
      maxDocs: 100,
    },
    { name: "name sort", input: { sort: "name:asc" }, expected: ["doctor_name"], maxDocs: 20 },
  ])("uses a bounded indexed query for $name", async ({ name, input, expected, maxDocs }) => {
    const query = doctorListSchema.parse(input);
    const explanation: unknown = await DoctorModel.find(buildDoctorFilter(query))
      .select(doctorProjection)
      .sort(buildDoctorSort(query))
      .limit(query.limit)
      .explain("executionStats");
    const parsed = explainSchema.parse(explanation);
    const indexes = indexNames(parsed.queryPlanner.winningPlan);
    expect(indexes.some((index) => expected.includes(index))).toBe(true);
    expect(parsed.executionStats.totalDocsExamined).toBeLessThanOrEqual(maxDocs);
    expect(parsed.executionStats.nReturned).toBe(20);
    process.stdout.write(`${JSON.stringify({ query: name, indexes, ...parsed.executionStats })}\n`);
  });
});

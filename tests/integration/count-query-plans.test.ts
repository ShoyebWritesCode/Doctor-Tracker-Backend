import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { DoctorModel } from "../../src/modules/doctors/doctor.model.js";
import { PatientModel } from "../../src/modules/patients/patient.model.js";
import { listDoctors } from "../../src/modules/doctors/doctor.service.js";
import { listPatients } from "../../src/modules/patients/patient.service.js";
import { doctorListSchema } from "../../src/modules/doctors/doctor.validation.js";
import { patientListSchema } from "../../src/modules/patients/patient.validation.js";

const statsSchema = z.object({
  executionStats: z.object({ totalDocsExamined: z.number(), totalKeysExamined: z.number() }),
});
function stats(value: unknown): z.infer<typeof statsSchema>["executionStats"] {
  const direct = statsSchema.safeParse(value);
  if (direct.success) return direct.data.executionStats;
  const aggregate = z.object({ stages: z.array(z.record(z.string(), z.unknown())) }).parse(value);
  return statsSchema.parse(aggregate.stages.find((stage) => "$cursor" in stage)?.$cursor)
    .executionStats;
}
let mongo: MongoMemoryServer;
async function explainCount(collection: string, hint?: string) {
  // Exact pipeline used by this installed Node driver's countDocuments(). Its
  // scalar count API does not return the raw explain document, so inspect the
  // equivalent aggregate and separately observe the real service command below.
  const pipeline = [{ $match: {} }, { $group: { _id: 1, n: { $sum: 1 } } }];
  return stats(
    await mongoose.connection
      .db!.collection(collection)
      .aggregate(pipeline, hint ? { hint } : {})
      .explain("executionStats"),
  );
}
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri("count_query_plan_tests"), { monitorCommands: true });
  await Promise.all([DoctorModel.syncIndexes(), PatientModel.syncIndexes()]);
  const doctors = await DoctorModel.insertMany(
    Array.from({ length: 2000 }, (_, index) => ({
      name: `Fictional Count Doctor ${index}`,
      specialization: "Cardiology",
      hospital: "Fictional Count Practice",
      email: `count-doctor-${index}@example.test`,
      phone: "+1 202-555-0100",
      patientCount: index === 0 ? 2000 : 0,
    })),
  );
  await PatientModel.insertMany(
    Array.from({ length: 2000 }, (_, index) => ({
      doctorId: doctors[0]!._id,
      name: `Fictional Count Patient ${index}`,
      phone: "+1 202-555-0101",
      condition: "Routine review",
      status: "active",
    })),
  );
}, 30_000);
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe("empty-filter exact list counts on 2000 fictional records", () => {
  it.each([
    {
      collection: "doctors",
      baseline: () => explainCount("doctors"),
      indexed: () => explainCount("doctors", "_id_"),
      exercise: () => listDoctors(doctorListSchema.parse({})),
      filtered: () => listDoctors(doctorListSchema.parse({ specialization: "Cardiology" })),
    },
    {
      collection: "patients",
      baseline: () => explainCount("patients"),
      indexed: () => explainCount("patients", "_id_"),
      exercise: () => listPatients(patientListSchema.parse({})),
      filtered: () => listPatients(patientListSchema.parse({ status: "active" })),
    },
  ])(
    "avoids document scans in the actual $collection list service without forcing filtered counts",
    async ({ collection, baseline, indexed, exercise, filtered }) => {
      const before = await baseline();
      const after = await indexed();
      expect(before.totalDocsExamined).toBe(2000);
      expect(after.totalDocsExamined).toBe(0);
      expect(after.totalKeysExamined).toBeLessThanOrEqual(2001);
      process.stdout.write(
        `${JSON.stringify({ query: `${collection} empty-filter count`, before, after })}\n`,
      );
      const hints: unknown[] = [];
      const started = (event: mongoose.mongo.CommandStartedEvent) => {
        if (event.command.aggregate === collection) hints.push(event.command.hint);
      };
      mongoose.connection.getClient().on("commandStarted", started);
      try {
        const result = await exercise();
        expect(result.meta.total).toBe(2000);
        expect(hints).toEqual(["_id_"]);
        hints.length = 0;
        expect((await filtered()).meta.total).toBe(2000);
        expect(hints).toEqual([undefined]);
      } finally {
        mongoose.connection.getClient().off("commandStarted", started);
      }
    },
  );
});

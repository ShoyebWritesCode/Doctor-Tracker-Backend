import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildDemoData, DEMO_PATIENT_LOADS } from "../../src/scripts/demo-data.js";
import { seedDemoData } from "../../src/scripts/seed-demo.js";
import { DoctorModel } from "../../src/modules/doctors/doctor.model.js";
import { PatientModel } from "../../src/modules/patients/patient.model.js";
import { createPatient } from "../../src/modules/patients/patient.service.js";

let mongo: MongoMemoryReplSet | undefined;
const now = new Date("2026-11-11T16:00:00Z");
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri("demo_seed_tests"));
  await Promise.all([DoctorModel.syncIndexes(), PatientModel.syncIndexes()]);
}, 30_000);
beforeEach(async () => {
  await PatientModel.deleteMany({});
  await DoctorModel.deleteMany({});
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

describe("fictional demo dataset", () => {
  it("builds diverse, repeatable, historically dated data with reserved contact details", () => {
    const demo = buildDemoData(now);
    expect(demo.doctors).toHaveLength(24);
    expect(demo.patients).toHaveLength(256);
    expect(new Set(demo.patients.map((patient) => String(patient._id))).size).toBe(256);
    expect(new Set(demo.patients.map((patient) => patient.name)).size).toBe(256);
    expect(new Set(demo.doctors.map((doctor) => doctor.specialization)).size).toBe(12);
    expect(new Set(demo.patients.map((patient) => patient.status)).size).toBe(3);
    expect(
      new Set(demo.patients.map((patient) => patient.createdAt.toISOString().slice(0, 10))).size,
    ).toBeGreaterThan(35);
    expect(
      demo.patients.every(
        (patient) =>
          patient.createdAt <= patient.lastVisitAt &&
          patient.lastVisitAt <= patient.updatedAt &&
          patient.updatedAt <= now,
      ),
    ).toBe(true);
    expect(demo.patients.every((patient) => patient.notes?.includes("fictional"))).toBe(true);
    expect(
      demo.patients.every((patient) => !patient.email || patient.email.endsWith(".example.test")),
    ).toBe(true);
    expect(
      demo.patients.every(
        (patient) => !patient.phone || /^\+1 202-555-01\d{2}$/.test(patient.phone),
      ),
    ).toBe(true);
    expect(
      buildDemoData(new Date("2026-12-11T16:00:00Z")).patients.map((patient) =>
        String(patient._id),
      ),
    ).toEqual(demo.patients.map((patient) => String(patient._id)));
  });

  it("defaults to a dry run without writing records", async () => {
    expect(await seedDemoData({ now })).toMatchObject({
      mode: "dry-run",
      doctorsToAdd: 24,
      patientsToAdd: 256,
    });
    expect(await DoctorModel.countDocuments()).toBe(0);
    expect(await PatientModel.countDocuments()).toBe(0);
  });

  it("keeps existing records and edits, remains idempotent, and maintains actual doctor counts", async () => {
    const existing = await DoctorModel.create({
      name: "Existing Doctor",
      specialization: "General Medicine",
      hospital: "Existing Practice",
      phone: "+1 202-555-0199",
      email: "existing@example.test",
    });
    await createPatient(String(existing._id), {
      name: "Existing Patient",
      condition: "Existing record",
      status: "active",
      phone: "+1 202-555-0198",
    });
    const before = await DoctorModel.findById(existing._id).lean();
    expect(await seedDemoData({ apply: true, now })).toMatchObject({
      doctorsToAdd: 24,
      patientsToAdd: 256,
    });
    expect(await DoctorModel.countDocuments()).toBe(25);
    expect(await PatientModel.countDocuments()).toBe(257);
    expect(await DoctorModel.findById(existing._id).lean()).toEqual(before);
    const demo = buildDemoData(now);
    for (const [index, doctor] of demo.doctors.entries()) {
      const stored = await DoctorModel.findById(doctor._id).lean();
      expect(stored?.patientCount).toBe(DEMO_PATIENT_LOADS[index]);
      expect(await PatientModel.countDocuments({ doctorId: doctor._id })).toBe(
        stored?.patientCount,
      );
      expect(stored?.createdAt).toEqual(doctor.createdAt);
    }
    const edited = await PatientModel.findById(demo.patients[0]!._id);
    edited!.name = "Administrator edited this demo patient";
    edited!.status = "follow_up";
    await edited!.save();
    await createPatient(String(demo.doctors[0]!._id), {
      name: "New manual patient",
      condition: "User-added record",
      status: "active",
      phone: "+1 202-555-0197",
    });
    const beforeRepeat = await PatientModel.findById(edited!._id).lean();
    expect(
      await seedDemoData({ apply: true, now: new Date("2026-12-11T16:00:00Z") }),
    ).toMatchObject({ doctorsToAdd: 0, patientsToAdd: 0 });
    expect(await PatientModel.findById(edited!._id).lean()).toEqual(beforeRepeat);
    expect((await DoctorModel.findById(demo.doctors[0]!._id).lean())?.patientCount).toBe(29);
    expect(await PatientModel.countDocuments()).toBe(258);
    const first = await PatientModel.findById(demo.patients[1]!._id)
      .select("+nameNormalized +conditionNormalized +phoneNormalized")
      .lean();
    expect(first?.nameNormalized).toBe(first?.name.toLowerCase());
    expect(first?.conditionNormalized).toBe(first?.condition.toLowerCase());
    expect(first?.createdAt).toEqual(demo.patients[1]!.createdAt);
  });

  it("rolls back the whole dataset if a reserved demo email conflicts with another record", async () => {
    const doctor = buildDemoData(now).doctors[0]!;
    await DoctorModel.create({
      name: "Existing email owner",
      specialization: "General Medicine",
      hospital: "Existing practice",
      phone: "+1 202-555-0199",
      email: doctor.email,
    });
    await expect(seedDemoData({ apply: true, now })).rejects.toMatchObject({ code: 11000 });
    expect(await DoctorModel.countDocuments()).toBe(1);
    expect(await PatientModel.countDocuments()).toBe(0);
  });
});

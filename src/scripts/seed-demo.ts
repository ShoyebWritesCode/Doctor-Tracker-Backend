import "dotenv/config";
import { pathToFileURL } from "node:url";
import mongoose from "mongoose";
import { parseEnv } from "../config/env.js";
import { createLogger } from "../config/logger.js";
import { connectMongo, disconnectMongo } from "../database/mongo.js";
import { DoctorModel } from "../modules/doctors/doctor.model.js";
import { PatientModel } from "../modules/patients/patient.model.js";
import { buildDemoData } from "./demo-data.js";

/** Add missing demo records only; never reset the database or replace existing fields. */
export async function seedDemoData({ apply = false, now = new Date() } = {}) {
  const demo = buildDemoData(now);
  const session = await mongoose.startSession();
  try {
    const result = await session.withTransaction(async () => {
      const existingDoctors = await DoctorModel.find({
        _id: { $in: demo.doctors.map((doctor) => doctor._id) },
      })
        .select("_id")
        .session(session)
        .lean();
      const existingPatients = await PatientModel.find({
        _id: { $in: demo.patients.map((patient) => patient._id) },
      })
        .select("_id")
        .session(session)
        .lean();
      const doctorIds = new Set(existingDoctors.map((doctor) => String(doctor._id)));
      const patientIds = new Set(existingPatients.map((patient) => String(patient._id)));
      const doctors = demo.doctors.filter((doctor) => !doctorIds.has(String(doctor._id)));
      const patients = demo.patients.filter((patient) => !patientIds.has(String(patient._id)));
      const summary = {
        mode: apply ? "applied" : "dry-run",
        doctorsToAdd: doctors.length,
        patientsToAdd: patients.length,
        existingDemoDoctors: existingDoctors.length,
        existingDemoPatients: existingPatients.length,
      };
      if (!apply) return summary;
      if (doctors.length) await DoctorModel.insertMany(doctors, { session, ordered: true });
      if (patients.length) {
        await PatientModel.insertMany(patients, { session, ordered: true });
        const increments = new Map<string, number>();
        for (const patient of patients)
          increments.set(
            String(patient.doctorId),
            (increments.get(String(patient.doctorId)) ?? 0) + 1,
          );
        const updated = await DoctorModel.bulkWrite(
          Array.from(increments, ([doctorId, count]) => ({
            updateOne: {
              filter: { _id: new mongoose.Types.ObjectId(doctorId) },
              update: { $inc: { patientCount: count } },
            },
          })),
          { session, ordered: true },
        );
        if (updated.matchedCount !== increments.size)
          throw new Error("Demo doctor references could not be reconciled");
      }
      return summary;
    });
    return result;
  } finally {
    await session.endSession();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const logger = createLogger({ level: "info", nodeEnv: "production" });
  try {
    const allowed = new Set(["--apply"]);
    if (process.argv.slice(2).some((argument) => !allowed.has(argument)))
      throw new Error("Unsupported seed argument");
    const config = parseEnv(process.env);
    await connectMongo({ logger, uri: config.MONGODB_URI });
    const result = await seedDemoData({ apply: process.argv.includes("--apply") });
    logger.info(result, "Fictional demo dataset seed completed; existing records preserved");
  } catch (error) {
    logger.error(
      { errorType: error instanceof Error ? error.name : "UnknownError" },
      "Demo seed failed; inspect configuration or data conflicts before retrying",
    );
    process.exitCode = 1;
  } finally {
    await disconnectMongo(logger);
  }
}

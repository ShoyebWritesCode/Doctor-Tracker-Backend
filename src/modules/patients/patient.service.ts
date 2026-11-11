import mongoose, { type ClientSession, type QueryFilter, type SortOrder } from "mongoose";
import { AppError } from "../../common/errors/app-error.js";
import { normalizeText, normalizePhone, escapeSearch } from "../../common/validation/text.js";
import { DoctorModel } from "../doctors/doctor.model.js";
import {
  PatientModel,
  patientProjection,
  toPatientDto,
  type DoctorSummary,
  type Patient,
} from "./patient.model.js";
import type {
  CreatePatientInput,
  UpdatePatientInput,
  PatientListQuery,
} from "./patient.validation.js";

function patientNotFound(): AppError {
  return new AppError({
    code: "PATIENT_NOT_FOUND",
    message: "The requested patient does not exist.",
    statusCode: 404,
  });
}

async function findDoctor(id: string, session?: ClientSession): Promise<DoctorSummary> {
  const query = DoctorModel.findById(id).select({ _id: 1, name: 1 });
  if (session) query.session(session);
  const doctor = await query.lean().exec();
  if (!doctor)
    throw new AppError({
      code: "DOCTOR_NOT_FOUND",
      message: "The requested doctor does not exist.",
      statusCode: 404,
    });
  return doctor;
}

const transactionOptions = {
  readConcern: { level: "snapshot" },
  writeConcern: { w: "majority" },
  readPreference: "primary",
} as const;

export async function createPatient(doctorId: string, input: CreatePatientInput) {
  return mongoose.connection.transaction(async (session) => {
    const doctor = await findDoctor(doctorId, session);
    await DoctorModel.updateOne(
      { _id: doctor._id },
      { $inc: { patientCount: 1 } },
      { session },
    ).exec();
    const [patient] = await PatientModel.create(
      [
        {
          doctorId: doctor._id,
          name: input.name,
          condition: input.condition,
          status: input.status,
          email: input.email ?? null,
          phone: input.phone ?? null,
          dateOfBirth: input.dateOfBirth ?? null,
          gender: input.gender ?? null,
          lastVisitAt: input.lastVisitAt ? new Date(input.lastVisitAt) : null,
          notes: input.notes ?? null,
        },
      ],
      { session },
    );
    if (!patient) throw new Error("Patient insertion did not return a record.");
    return toPatientDto(patient, doctor);
  }, transactionOptions);
}

export function buildPatientFilter(query: PatientListQuery): QueryFilter<Patient> {
  const filter: QueryFilter<Patient> = {};
  if (query.doctorId) filter.doctorId = new mongoose.Types.ObjectId(query.doctorId);
  if (query.condition) filter.conditionNormalized = normalizeText(query.condition);
  if (query.status) filter.status = query.status;
  if (query.createdFrom || query.createdTo)
    filter.createdAt = {
      ...(query.createdFrom ? { $gte: new Date(query.createdFrom) } : {}),
      ...(query.createdTo ? { $lt: new Date(query.createdTo) } : {}),
    };
  if (query.search) {
    const prefix = new RegExp(`^${escapeSearch(normalizeText(query.search))}`);
    const phonePrefix = normalizePhone(query.search);
    filter.$or = [
      { nameNormalized: prefix },
      { email: prefix },
      ...(phonePrefix ? [{ phoneNormalized: new RegExp(`^${escapeSearch(phonePrefix)}`) }] : []),
    ];
  }
  return filter;
}

export function buildPatientSort(query: PatientListQuery): Record<string, SortOrder> {
  const direction = query.sort.endsWith(":asc") ? 1 : -1;
  const field = query.sort.startsWith("name:")
    ? "nameNormalized"
    : query.sort.startsWith("lastVisitAt:")
      ? "lastVisitAt"
      : "createdAt";
  return { [field]: direction, _id: direction };
}

export async function listPatients(query: PatientListQuery, scopedDoctorId?: string) {
  if (scopedDoctorId) await findDoctor(scopedDoctorId);
  const filter = buildPatientFilter(
    scopedDoctorId ? { ...query, doctorId: scopedDoctorId } : query,
  );
  const [patients, total] = await Promise.all([
    PatientModel.find(filter)
      .select(patientProjection)
      .sort(buildPatientSort(query))
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .populate<{ doctorId: DoctorSummary | null }>({
        path: "doctorId",
        select: { _id: 1, name: 1 },
      })
      .lean()
      .exec(),
    PatientModel.countDocuments(filter).exec(),
  ]);
  return {
    data: patients.map((patient) => toPatientDto(patient, patient.doctorId)),
    meta: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}

export async function getPatient(patientId: string) {
  const patient = await PatientModel.findById(patientId)
    .select(patientProjection)
    .populate<{ doctorId: DoctorSummary | null }>({ path: "doctorId", select: { _id: 1, name: 1 } })
    .lean()
    .exec();
  if (!patient) throw patientNotFound();
  return toPatientDto(patient, patient.doctorId);
}

export async function updatePatient(patientId: string, input: UpdatePatientInput) {
  // Read, merge, validate and write in one transaction so concurrent contact
  // removals cannot independently pass validation and leave both contacts empty.
  return mongoose.connection.transaction(async (session) => {
    const patient = await PatientModel.findById(patientId).session(session).exec();
    if (!patient) throw patientNotFound();
    patient.set(input);
    if (!patient.email && !patient.phone)
      throw new AppError({
        code: "VALIDATION_ERROR",
        message: "Provide an email address or phone number.",
        fieldErrors: { email: ["At least one contact method must remain."] },
        statusCode: 400,
      });
    await patient.save({ session });
    const doctor = await findDoctor(patient.doctorId.toHexString(), session);
    return toPatientDto(patient, doctor);
  }, transactionOptions);
}

export async function deletePatient(patientId: string, scopedDoctorId?: string): Promise<void> {
  await mongoose.connection.transaction(async (session) => {
    if (scopedDoctorId) await findDoctor(scopedDoctorId, session);
    const patient = await PatientModel.findOneAndDelete(
      { _id: patientId, ...(scopedDoctorId ? { doctorId: scopedDoctorId } : {}) },
      { session },
    ).exec();
    if (!patient) throw patientNotFound();
    const updated = await DoctorModel.updateOne(
      { _id: patient.doctorId, patientCount: { $gte: 1 } },
      { $inc: { patientCount: -1 } },
      { session },
    ).exec();
    if (updated.modifiedCount !== 1)
      throw new AppError({
        code: "INTERNAL_ERROR",
        isOperational: false,
        message: "The patient record could not be deleted.",
        statusCode: 500,
      });
  }, transactionOptions);
}

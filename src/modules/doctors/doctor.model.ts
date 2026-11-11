import mongoose, { Schema, model, type InferSchemaType, type Model } from "mongoose";
import { normalizeDoctorText } from "./doctor.validation.js";

const doctorSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    nameNormalized: { type: String, required: true, select: false },
    specialization: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    specializationNormalized: { type: String, required: true, select: false },
    hospital: { type: String, required: true, trim: true, minlength: 2, maxlength: 160 },
    hospitalNormalized: { type: String, required: true, select: false },
    phone: { type: String, required: true, trim: true, minlength: 7, maxlength: 32 },
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    patientCount: { type: Number, required: true, default: 0, min: 0, validate: Number.isInteger },
  },
  { collection: "doctors", timestamps: true, versionKey: false, strict: "throw" },
);

doctorSchema.pre("validate", function () {
  if (this.name) this.nameNormalized = normalizeDoctorText(this.name);
  if (this.specialization) this.specializationNormalized = normalizeDoctorText(this.specialization);
  if (this.hospital) this.hospitalNormalized = normalizeDoctorText(this.hospital);
});

doctorSchema.index({ email: 1 }, { name: "doctor_email_unique", unique: true });
doctorSchema.index({ createdAt: -1, _id: -1 }, { name: "doctor_created" });
doctorSchema.index(
  { specializationNormalized: 1, createdAt: -1, _id: -1 },
  { name: "doctor_specialization_created" },
);
doctorSchema.index(
  { hospitalNormalized: 1, createdAt: -1, _id: -1 },
  { name: "doctor_hospital_created" },
);
doctorSchema.index({ nameNormalized: 1, _id: 1 }, { name: "doctor_name" });
doctorSchema.index({ patientCount: -1, name: 1, _id: 1 }, { name: "doctor_patient_ranking" });

export type Doctor = InferSchemaType<typeof doctorSchema>;
export const DoctorModel =
  (mongoose.models.Doctor as Model<Doctor> | undefined) ?? model<Doctor>("Doctor", doctorSchema);

export const doctorProjection = {
  _id: 1,
  name: 1,
  specialization: 1,
  hospital: 1,
  phone: 1,
  email: 1,
  patientCount: 1,
  createdAt: 1,
  updatedAt: 1,
} as const;
type PublicDoctorRecord = Pick<
  Doctor,
  | "name"
  | "specialization"
  | "hospital"
  | "phone"
  | "email"
  | "patientCount"
  | "createdAt"
  | "updatedAt"
> & { _id: mongoose.Types.ObjectId };

export function toDoctorDto(doctor: PublicDoctorRecord) {
  return {
    id: doctor._id.toHexString(),
    name: doctor.name,
    specialization: doctor.specialization,
    hospital: doctor.hospital,
    phone: doctor.phone,
    email: doctor.email,
    patientCount: doctor.patientCount,
    createdAt: doctor.createdAt.toISOString(),
    updatedAt: doctor.updatedAt.toISOString(),
  };
}

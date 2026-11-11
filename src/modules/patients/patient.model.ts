import mongoose, { Schema, model, type InferSchemaType, type Model, type Types } from "mongoose";
import { AppError } from "../../common/errors/app-error.js";
import { normalizePhone, normalizeText } from "../../common/validation/text.js";

const patientSchema = new Schema(
  {
    doctorId: { type: Schema.Types.ObjectId, ref: "Doctor", required: true, immutable: true },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    nameNormalized: { type: String, required: true, select: false },
    email: { type: String, default: null, trim: true, lowercase: true, maxlength: 254 },
    phone: { type: String, default: null, trim: true, minlength: 7, maxlength: 32 },
    phoneNormalized: { type: String, default: null, select: false },
    dateOfBirth: { type: String, default: null },
    gender: {
      type: String,
      enum: ["female", "male", "non_binary", "prefer_not_to_say", null],
      default: null,
    },
    condition: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    conditionNormalized: { type: String, required: true, select: false },
    status: { type: String, enum: ["active", "follow_up", "discharged"], required: true },
    lastVisitAt: { type: Date, default: null },
    notes: { type: String, default: null, trim: true, maxlength: 1000 },
  },
  { collection: "patients", timestamps: true, versionKey: false, strict: "throw" },
);

patientSchema.pre("validate", function () {
  if (this.name) this.nameNormalized = normalizeText(this.name);
  if (this.condition) this.conditionNormalized = normalizeText(this.condition);
  this.phoneNormalized = this.phone ? normalizePhone(this.phone) : null;
  if (!this.email && !this.phone)
    this.invalidate("email", "Provide an email address or phone number.");
});

patientSchema.index({ doctorId: 1, createdAt: -1, _id: -1 }, { name: "patient_doctor_created" });
patientSchema.index({ createdAt: -1, _id: -1 }, { name: "patient_created" });
patientSchema.index(
  { conditionNormalized: 1, createdAt: -1, _id: -1 },
  { name: "patient_condition_created" },
);
patientSchema.index({ status: 1, createdAt: -1, _id: -1 }, { name: "patient_status_created" });
patientSchema.index({ nameNormalized: 1, _id: 1 }, { name: "patient_name" });
patientSchema.index({ lastVisitAt: -1, _id: -1 }, { name: "patient_last_visit" });
patientSchema.index({ email: 1 }, { name: "patient_email_prefix" });
patientSchema.index({ phoneNormalized: 1 }, { name: "patient_phone_prefix" });

export type Patient = InferSchemaType<typeof patientSchema>;
export const PatientModel =
  (mongoose.models.Patient as Model<Patient> | undefined) ??
  model<Patient>("Patient", patientSchema);

export type DoctorSummary = { _id: Types.ObjectId; name: string };
export const patientProjection = {
  _id: 1,
  doctorId: 1,
  name: 1,
  email: 1,
  phone: 1,
  dateOfBirth: 1,
  gender: 1,
  condition: 1,
  status: 1,
  lastVisitAt: 1,
  notes: 1,
  createdAt: 1,
  updatedAt: 1,
} as const;
type PublicPatient = Pick<
  Patient,
  | "name"
  | "email"
  | "phone"
  | "dateOfBirth"
  | "gender"
  | "condition"
  | "status"
  | "lastVisitAt"
  | "notes"
  | "createdAt"
  | "updatedAt"
> & { _id: Types.ObjectId };

export function toPatientDto(patient: PublicPatient, doctor: DoctorSummary | null) {
  if (!doctor)
    throw new AppError({
      code: "INTERNAL_ERROR",
      isOperational: false,
      message: "The patient record could not be loaded.",
      statusCode: 500,
    });
  return {
    id: patient._id.toHexString(),
    doctor: { id: doctor._id.toHexString(), name: doctor.name },
    name: patient.name,
    email: patient.email ?? null,
    phone: patient.phone ?? null,
    dateOfBirth: patient.dateOfBirth ?? null,
    gender: patient.gender ?? null,
    condition: patient.condition,
    status: patient.status,
    lastVisitAt: patient.lastVisitAt?.toISOString() ?? null,
    notes: patient.notes ?? null,
    createdAt: patient.createdAt.toISOString(),
    updatedAt: patient.updatedAt.toISOString(),
  };
}

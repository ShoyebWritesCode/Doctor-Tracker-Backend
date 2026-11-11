import { z } from "zod";
import { listQueryFields, validateListRange } from "../../common/validation/list-query.js";

export const objectIdSchema = z.string().regex(/^[a-f0-9]{24}$/, "Enter a valid record ID.");
export const doctorParamsSchema = z.strictObject({ doctorId: objectIdSchema });
export const patientParamsSchema = z.strictObject({ patientId: objectIdSchema });
export const scopedPatientParamsSchema = doctorParamsSchema.extend({ patientId: objectIdSchema });

const email = z
  .string()
  .trim()
  .max(254)
  .pipe(z.email())
  .transform((value) => value.toLowerCase());
const phone = z.string().trim().min(7).max(32);
const name = z.string().trim().min(2).max(120);
const condition = z.string().trim().min(2).max(120);
const status = z.enum(["active", "follow_up", "discharged"]);
const gender = z.enum(["female", "male", "non_binary", "prefer_not_to_say"]);
const dateOfBirth = z.iso.date();
const lastVisitAt = z.iso.datetime({ offset: true });
const notes = z.string().trim().max(1000);

export const createPatientSchema = z
  .strictObject({
    name,
    condition,
    status,
    email: email.optional(),
    phone: phone.optional(),
    dateOfBirth: dateOfBirth.optional(),
    gender: gender.optional(),
    lastVisitAt: lastVisitAt.optional(),
    notes: notes.optional(),
  })
  .refine((value) => Boolean(value.email || value.phone), {
    path: ["email"],
    message: "Provide an email address or phone number.",
  });

export const updatePatientSchema = z
  .strictObject({
    name: name.optional(),
    condition: condition.optional(),
    status: status.optional(),
    email: email.nullable().optional(),
    phone: phone.nullable().optional(),
    dateOfBirth: dateOfBirth.nullable().optional(),
    gender: gender.nullable().optional(),
    lastVisitAt: lastVisitAt.nullable().optional(),
    notes: notes.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update.",
  });

const patientListFields = {
  ...listQueryFields,
  condition: z.string().trim().min(1).max(120).optional(),
  status: status.optional(),
  sort: z
    .enum([
      "createdAt:desc",
      "createdAt:asc",
      "name:asc",
      "name:desc",
      "lastVisitAt:desc",
      "lastVisitAt:asc",
    ])
    .default("createdAt:desc"),
};
export const scopedPatientListSchema = z
  .strictObject(patientListFields)
  .superRefine(validateListRange);
export const patientListSchema = z
  .strictObject({ ...patientListFields, doctorId: objectIdSchema.optional() })
  .superRefine(validateListRange);

export type CreatePatientInput = z.infer<typeof createPatientSchema>;
export type UpdatePatientInput = z.infer<typeof updatePatientSchema>;
export type PatientListQuery = z.infer<typeof patientListSchema>;

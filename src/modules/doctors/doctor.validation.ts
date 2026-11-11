import { z } from "zod";
import { listQueryFields, validateListRange } from "../../common/validation/list-query.js";
export {
  normalizeText as normalizeDoctorText,
  escapeSearch,
} from "../../common/validation/text.js";

export const createDoctorSchema = z.strictObject({
  name: z.string().trim().min(2).max(120),
  specialization: z.string().trim().min(2).max(100),
  hospital: z.string().trim().min(2).max(160),
  phone: z.string().trim().min(7).max(32),
  email: z
    .string()
    .trim()
    .max(254)
    .pipe(z.email())
    .transform((value) => value.toLowerCase()),
});

export const doctorIdSchema = z.string().regex(/^[a-f0-9]{24}$/, "Enter a valid doctor ID.");

export const doctorListSchema = z
  .strictObject({
    ...listQueryFields,
    specialization: z.string().trim().min(1).max(100).optional(),
    hospital: z.string().trim().min(1).max(160).optional(),
    sort: z
      .enum(["createdAt:desc", "createdAt:asc", "name:asc", "name:desc"])
      .default("createdAt:desc"),
  })
  .superRefine(validateListRange);

export type CreateDoctorInput = z.infer<typeof createDoctorSchema>;
export type DoctorListQuery = z.infer<typeof doctorListSchema>;

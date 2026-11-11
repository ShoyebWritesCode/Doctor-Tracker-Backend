import { z } from "zod";

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

const positiveInteger = (maximum: number) =>
  z
    .string()
    .regex(/^[1-9]\d*$/, "Enter a positive integer.")
    .transform(Number)
    .pipe(z.number().int().min(1).max(maximum));

export const doctorListSchema = z
  .strictObject({
    page: positiveInteger(Number.MAX_SAFE_INTEGER).default(1),
    limit: positiveInteger(100).default(20),
    search: z.string().trim().min(1).max(100).optional(),
    specialization: z.string().trim().min(1).max(100).optional(),
    hospital: z.string().trim().min(1).max(160).optional(),
    createdFrom: z.iso.datetime({ offset: true }).optional(),
    createdTo: z.iso.datetime({ offset: true }).optional(),
    sort: z
      .enum(["createdAt:desc", "createdAt:asc", "name:asc", "name:desc"])
      .default("createdAt:desc"),
  })
  .superRefine((query, context) => {
    if (!Number.isSafeInteger((query.page - 1) * query.limit)) {
      context.addIssue({
        code: "custom",
        path: ["page"],
        message: "The requested page offset is too large.",
      });
    }
    if (
      query.createdFrom &&
      query.createdTo &&
      new Date(query.createdFrom) >= new Date(query.createdTo)
    ) {
      context.addIssue({
        code: "custom",
        path: ["createdTo"],
        message: "createdTo must be later than createdFrom.",
      });
    }
  });

export type CreateDoctorInput = z.infer<typeof createDoctorSchema>;
export type DoctorListQuery = z.infer<typeof doctorListSchema>;

export function normalizeDoctorText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function escapeSearch(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

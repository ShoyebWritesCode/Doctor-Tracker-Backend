import { z } from "zod";

const positiveInteger = (maximum: number) =>
  z
    .string()
    .regex(/^[1-9]\d*$/, "Enter a positive integer.")
    .transform(Number)
    .pipe(z.number().int().min(1).max(maximum));

export const listQueryFields = {
  page: positiveInteger(Number.MAX_SAFE_INTEGER).default(1),
  limit: positiveInteger(100).default(20),
  search: z.string().trim().min(1).max(100).optional(),
  createdFrom: z.iso.datetime({ offset: true }).optional(),
  createdTo: z.iso.datetime({ offset: true }).optional(),
};

export function validateListRange(
  query: {
    page: number;
    limit: number;
    createdFrom?: string | undefined;
    createdTo?: string | undefined;
  },
  context: z.RefinementCtx,
): void {
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
}

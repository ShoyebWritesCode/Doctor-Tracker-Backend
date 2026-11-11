import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";

export const MAX_DASHBOARD_DAYS = 366;

function validTimeZone(value: string): boolean {
  // Temporal also accepts fixed offsets. The API deliberately accepts named IANA zones only.
  if (!/^[A-Za-z][A-Za-z0-9._+-]*(?:\/[A-Za-z0-9._+-]+)*$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const dashboardQuerySchema = z
  .strictObject({
    from: z.iso.date(),
    to: z.iso.date(),
    timezone: z
      .string()
      .min(1)
      .max(100)
      .refine(validTimeZone, "Enter a valid IANA time-zone name.")
      .transform(
        (zone) => new Intl.DateTimeFormat("en", { timeZone: zone }).resolvedOptions().timeZone,
      )
      .default("Asia/Dhaka"),
  })
  .superRefine((query, context) => {
    // Zod's field checks run before this refinement; malformed calendar strings must not reach Temporal.
    if (!z.iso.date().safeParse(query.from).success || !z.iso.date().safeParse(query.to).success)
      return;
    const days = Temporal.PlainDate.from(query.from).until(Temporal.PlainDate.from(query.to)).days;
    if (days <= 0 || days > MAX_DASHBOARD_DAYS)
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: `Choose an exclusive end date after the start and no more than ${MAX_DASHBOARD_DAYS} calendar days later.`,
      });
  });
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

export function dashboardRange(query: DashboardQuery) {
  const from = Temporal.PlainDate.from(query.from);
  const to = Temporal.PlainDate.from(query.to);
  const dates: string[] = [];
  for (let date = from; Temporal.PlainDate.compare(date, to) < 0; date = date.add({ days: 1 }))
    dates.push(date.toString());
  return {
    // Each boundary is converted independently: a local day is not necessarily 24 hours.
    from: new Date(from.toZonedDateTime(query.timezone).epochMilliseconds),
    to: new Date(to.toZonedDateTime(query.timezone).epochMilliseconds),
    dates,
  };
}

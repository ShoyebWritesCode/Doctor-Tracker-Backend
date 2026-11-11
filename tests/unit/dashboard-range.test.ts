import { describe, expect, it } from "vitest";
import {
  dashboardQuerySchema,
  dashboardRange,
} from "../../src/modules/dashboard/dashboard.validation.js";

describe("dashboard calendar ranges", () => {
  it("defaults to Dhaka and canonicalizes named zones", () => {
    expect(dashboardQuerySchema.parse({ from: "2026-01-01", to: "2026-01-02" }).timezone).toBe(
      "Asia/Dhaka",
    );
    expect(
      dashboardQuerySchema.parse({ from: "2026-01-01", to: "2026-01-02", timezone: "asia/dhaka" })
        .timezone,
    ).toBe("Asia/Dhaka");
  });
  it.each([
    {},
    { from: "2026-01-01" },
    { from: "2026-02-30", to: "2026-03-02" },
    { from: "2026-01-01T00:00:00Z", to: "2026-01-02" },
    { from: "2026-01-02", to: "2026-01-02" },
    { from: "2026-01-02", to: "2026-01-01" },
    { from: "2024-01-01", to: "2025-01-02" },
    { from: "2026-01-01", to: "2026-01-02", timezone: "+06:00" },
    { from: "2026-01-01", to: "2026-01-02", timezone: "Not/AZone" },
    { from: "2026-01-01", to: "2026-01-02", timezone: "" },
    { from: "2026-01-01", to: "2026-01-02", extra: "ignored?" },
  ])("rejects malformed or unbounded input: %j", (input) => {
    expect(dashboardQuerySchema.safeParse(input).success).toBe(false);
  });
  it("accepts 366 calendar days across leap day and fills labels exactly once", () => {
    const range = dashboardRange(
      dashboardQuerySchema.parse({ from: "2024-01-01", to: "2025-01-01" }),
    );
    expect(range.dates).toHaveLength(366);
    expect(range.dates).toContain("2024-02-29");
    expect(new Set(range.dates).size).toBe(366);
    expect(range.dates.at(-1)).toBe("2024-12-31");
  });
  it.each([
    {
      from: "2026-03-08",
      to: "2026-03-09",
      timezone: "America/New_York",
      start: "2026-03-08T05:00:00.000Z",
      end: "2026-03-09T04:00:00.000Z",
      hours: 23,
    },
    {
      from: "2026-11-01",
      to: "2026-11-02",
      timezone: "America/New_York",
      start: "2026-11-01T04:00:00.000Z",
      end: "2026-11-02T05:00:00.000Z",
      hours: 25,
    },
    {
      from: "2026-01-01",
      to: "2026-01-02",
      timezone: "Asia/Kathmandu",
      start: "2025-12-31T18:15:00.000Z",
      end: "2026-01-01T18:15:00.000Z",
      hours: 24,
    },
    {
      from: "2018-11-04",
      to: "2018-11-05",
      timezone: "America/Sao_Paulo",
      start: "2018-11-04T03:00:00.000Z",
      end: "2018-11-05T02:00:00.000Z",
      hours: 23,
    },
  ])(
    "uses independent local-day boundaries for $timezone $from",
    ({ from, to, timezone, start, end, hours }) => {
      const range = dashboardRange(dashboardQuerySchema.parse({ from, to, timezone }));
      expect(range.from.toISOString()).toBe(start);
      expect(range.to.toISOString()).toBe(end);
      expect((range.to.getTime() - range.from.getTime()) / 3_600_000).toBe(hours);
      expect(range.dates).toEqual([from]);
    },
  );
  it("keeps a zero-able label for a date skipped by a dateline change", () => {
    const range = dashboardRange(
      dashboardQuerySchema.parse({
        from: "2011-12-29",
        to: "2012-01-01",
        timezone: "Pacific/Apia",
      }),
    );
    expect(range.dates).toEqual(["2011-12-29", "2011-12-30", "2011-12-31"]);
    expect((range.to.getTime() - range.from.getTime()) / 3_600_000).toBe(48);
  });
});

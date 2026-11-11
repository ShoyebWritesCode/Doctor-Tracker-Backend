import { describe, expect, it } from "vitest";
import {
  readCookie,
  serializeSessionCookie,
  serializeClearedSessionCookie,
} from "../../src/modules/auth/cookie.js";
import { normalizeText, normalizePhone, escapeSearch } from "../../src/common/validation/text.js";
import { doctorListSchema } from "../../src/modules/doctors/doctor.validation.js";
import { buildDoctorFilter, buildDoctorSort } from "../../src/modules/doctors/doctor.service.js";
import { patientListSchema } from "../../src/modules/patients/patient.validation.js";
import { buildPatientSort } from "../../src/modules/patients/patient.service.js";

describe("session-cookie boundaries", () => {
  it.each([undefined, "", "unrelated=value", "broken; another=thing", "session=%E0%A4%A"])(
    "safely rejects absent or malformed cookies: %s",
    (header) => {
      expect(readCookie(header, "session")).toBeUndefined();
    },
  );
  it("reads only the exact cookie name and preserves encoded separators", () => {
    expect(readCookie("session_extra=wrong; session=a%3Db%3Bc; other=x", "session")).toBe("a=b;c");
  });
  it("matches clearing scope/security and never sets a shared Domain", () => {
    const cookie = serializeSessionCookie({
      name: "session",
      token: "a=b;c",
      secure: true,
      expires: new Date("2026-11-12T00:00:00Z"),
    });
    expect(cookie).toContain("session=a%3Db%3Bc");
    expect(cookie).toContain("Path=/api/v1; HttpOnly; SameSite=Lax");
    expect(cookie).toContain("Secure");
    expect(cookie).not.toContain("Domain=");
    const cleared = serializeClearedSessionCookie("session", true);
    expect(cleared).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure");
    expect(serializeClearedSessionCookie("session", false)).not.toContain("Secure");
  });
  it.each(["unsafe name", "session; Domain=example.test", "session\r\nInjected: yes", ""])(
    "rejects unsafe cookie names: %s",
    (name) => {
      expect(() => serializeClearedSessionCookie(name, true)).toThrow(
        "Invalid session cookie name.",
      );
    },
  );
});

describe("list-query boundaries", () => {
  it("normalizes Unicode/whitespace and treats all regex punctuation literally", () => {
    expect(normalizeText("  Ｄｒ\t  Fictional\nName ")).toBe("dr fictional name");
    expect(normalizePhone(" +1 (202) 555-01.00 ")).toBe("12025550100");
    const search = ".*+?^${}()|[]\\";
    expect(new RegExp(`^${escapeSearch(search)}$`).test(search)).toBe(true);
    expect(new RegExp(`^${escapeSearch(search)}$`).test("anything")).toBe(false);
    const filter = buildDoctorFilter(doctorListSchema.parse({ search }));
    expect(
      filter.$or?.every((condition) =>
        Object.values(condition).every(
          (value) => value instanceof RegExp && value.flags === "" && value.source.startsWith("^"),
        ),
      ),
    ).toBe(true);
  });
  it("defaults and caps pages/limits without accepting coercion surprises", () => {
    expect(doctorListSchema.parse({})).toMatchObject({
      page: 1,
      limit: 20,
      sort: "createdAt:desc",
    });
    for (const limit of ["0", "101", "1.5", "01", "1e2", "Infinity", ["20", "50"]])
      expect(doctorListSchema.safeParse({ limit }).success).toBe(false);
    expect(
      doctorListSchema.safeParse({ page: String(Number.MAX_SAFE_INTEGER), limit: "100" }).success,
    ).toBe(false);
    expect(patientListSchema.safeParse({ sort: "$where" }).success).toBe(false);
  });
  it.each(["createdAt:asc", "createdAt:desc", "name:asc", "name:desc"])(
    "uses a deterministic doctor ID tie-breaker for %s",
    (sort) => {
      const direction = sort.endsWith(":asc") ? 1 : -1;
      expect(buildDoctorSort(doctorListSchema.parse({ sort }))).toEqual({
        [sort.startsWith("name:") ? "nameNormalized" : "createdAt"]: direction,
        _id: direction,
      });
    },
  );
  it.each([
    "createdAt:asc",
    "createdAt:desc",
    "name:asc",
    "name:desc",
    "lastVisitAt:asc",
    "lastVisitAt:desc",
  ])("uses a deterministic patient ID tie-breaker for %s", (sort) => {
    expect(buildPatientSort(patientListSchema.parse({ sort }))._id).toBe(
      sort.endsWith(":asc") ? 1 : -1,
    );
  });
  it("preserves inclusive/exclusive instant bounds and rejects reversed ranges", () => {
    const input = {
      createdFrom: "2026-11-01T06:00:00+06:00",
      createdTo: "2026-11-02T06:00:00+06:00",
    };
    const filter = buildDoctorFilter(doctorListSchema.parse(input));
    expect(filter.createdAt).toEqual({
      $gte: new Date("2026-11-01T00:00:00Z"),
      $lt: new Date("2026-11-02T00:00:00Z"),
    });
    expect(doctorListSchema.safeParse({ ...input, createdTo: input.createdFrom }).success).toBe(
      false,
    );
  });
});

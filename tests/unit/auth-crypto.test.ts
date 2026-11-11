import { describe, expect, it } from "vitest";
import { AdminModel } from "../../src/modules/auth/admin.model.js";
import { hashPassword, verifyPassword } from "../../src/modules/auth/password.js";
import { SessionModel } from "../../src/modules/auth/session.model.js";
import { createSessionToken, hashSessionToken } from "../../src/modules/auth/session-token.js";

describe("authentication primitives", () => {
  it("hashes passwords with Argon2id and verifies only the correct value", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(verifyPassword(hash, "correct horse battery staple")).resolves.toBe(true);
    await expect(verifyPassword(hash, "incorrect password")).resolves.toBe(false);
  });

  it("creates high-entropy tokens and deterministic SHA-256 hashes", () => {
    const first = createSessionToken();
    const second = createSessionToken();
    expect(first).not.toBe(second);
    expect(Buffer.from(first, "base64url")).toHaveLength(32);
    expect(hashSessionToken(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashSessionToken(first)).toBe(hashSessionToken(first));
  });

  it("declares the required unique, TTL, and lookup indexes", () => {
    expect(AdminModel.schema.indexes()).toContainEqual([
      { email: 1 },
      expect.objectContaining({ name: "admin_email_unique", unique: true }),
    ]);
    expect(SessionModel.schema.indexes()).toEqual(
      expect.arrayContaining([
        [{ tokenHash: 1 }, expect.objectContaining({ unique: true })],
        [{ expiresAt: 1 }, expect.objectContaining({ expireAfterSeconds: 0 })],
        [{ adminId: 1 }, expect.objectContaining({ name: "session_admin" })],
      ]),
    );
  });
});

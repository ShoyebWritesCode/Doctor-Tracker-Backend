import argon2 from "argon2";

const passwordOptions = {
  memoryCost: 19_456,
  parallelism: 1,
  timeCost: 2,
  type: argon2.argon2id,
} as const;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, passwordOptions);
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return argon2.verify(passwordHash, password);
}

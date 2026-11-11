import pino from "pino";

export function createTestLogger() {
  return pino({ level: "silent" });
}

import pino, { type Logger, type LoggerOptions } from "pino";
import { safeErrorDetails } from "../common/http/safe-error.js";

type LoggerConfig = {
  level: string;
  nodeEnv: "development" | "test" | "production";
};

const privateFields = [
  "password",
  "passwordHash",
  "token",
  "tokenHash",
  "session",
  "cookie",
  "authorization",
  "body",
  "query",
  "headers",
  "email",
  "phone",
  "notes",
  "MONGODB_URI",
  "uri",
];
const redactPaths = privateFields.flatMap((field) => [field, `*.${field}`]);

export function createLogger(config: LoggerConfig, destination?: pino.DestinationStream): Logger {
  const options: LoggerOptions = {
    base: {
      environment: config.nodeEnv,
      service: "doctor-tracker-api",
    },
    level: config.nodeEnv === "test" ? "silent" : config.level,
    serializers: { err: safeErrorDetails },
    redact: {
      censor: "[REDACTED]",
      paths: redactPaths,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  if (config.nodeEnv === "development" && !destination) {
    return pino(
      options,
      pino.transport({
        target: "pino-pretty",
        options: {
          colorize: true,
          ignore: "pid,hostname,service,environment",
          translateTime: "SYS:standard",
        },
      }),
    );
  }

  return destination ? pino(options, destination) : pino(options);
}

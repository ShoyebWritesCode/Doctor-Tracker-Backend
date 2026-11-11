import pino, { type Logger, type LoggerOptions } from "pino";

type LoggerConfig = {
  level: string;
  nodeEnv: "development" | "test" | "production";
};

const redactPaths = [
  "req.headers.authorization",
  "req.headers.cookie",
  "request.headers.authorization",
  "request.headers.cookie",
  "password",
  "token",
  "session",
  "*.password",
  "*.token",
  "*.session",
];

export function createLogger(config: LoggerConfig): Logger {
  const options: LoggerOptions = {
    base: {
      environment: config.nodeEnv,
      service: "doctor-tracker-api",
    },
    level: config.nodeEnv === "test" ? "silent" : config.level,
    redact: {
      censor: "[REDACTED]",
      paths: redactPaths,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  if (config.nodeEnv === "development") {
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

  return pino(options);
}

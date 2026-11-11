import { z } from "zod";

const booleanString = z.enum(["true", "false"]).transform((value) => value === "true");

const mongoUri = z
  .string()
  .min(1, "MONGODB_URI is required.")
  .refine(
    (value) => value.startsWith("mongodb://") || value.startsWith("mongodb+srv://"),
    "MONGODB_URI must use mongodb:// or mongodb+srv://.",
  );

const origin = z
  .url("FRONTEND_ORIGIN must be a valid URL.")
  .transform((value) => new URL(value))
  .refine(
    (value) => value.pathname === "/" && value.search === "" && value.hash === "",
    "FRONTEND_ORIGIN must contain only scheme, host, and optional port.",
  )
  .transform((value) => value.origin);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  MONGODB_URI: mongoUri,
  FRONTEND_ORIGIN: origin,
  SESSION_COOKIE_NAME: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/, "SESSION_COOKIE_NAME contains unsupported characters.")
    .default("doctor_tracker_session"),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24).default(12),
  COOKIE_SECURE: booleanString.default(false),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(2).default(0),
  LOGIN_IP_LIMIT: z.coerce.number().int().min(1).max(100).default(20),
  LOGIN_ACCOUNT_LIMIT: z.coerce.number().int().min(1).max(50).default(5),
  API_RATE_LIMIT: z.coerce.number().int().min(1).max(10_000).default(600),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type AppConfig = Readonly<z.infer<typeof envSchema>>;

export class EnvironmentConfigError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "EnvironmentConfigError";
  }
}

const seedEnvSchema = z.object({
  SEED_ADMIN_EMAIL: z
    .string()
    .trim()
    .pipe(z.email())
    .transform((value) => value.toLowerCase()),
  SEED_ADMIN_NAME: z.string().trim().min(2).max(100),
  SEED_ADMIN_PASSWORD: z.string().min(12).max(128),
});

export type SeedConfig = Readonly<z.infer<typeof seedEnvSchema>>;

export function parseSeedEnv(input: NodeJS.ProcessEnv): SeedConfig {
  const result = seedEnvSchema.safeParse(input);
  if (!result.success) {
    throw new EnvironmentConfigError(`Invalid seed configuration. ${formatIssues(result.error)}`);
  }
  return Object.freeze(result.data);
}

function assertProductionSafety(config: z.infer<typeof envSchema>): void {
  if (config.NODE_ENV !== "production") {
    return;
  }

  const failures: string[] = [];

  if (!config.COOKIE_SECURE) {
    failures.push("COOKIE_SECURE must be true in production.");
  }

  if (!config.FRONTEND_ORIGIN.startsWith("https://")) {
    failures.push("FRONTEND_ORIGIN must use HTTPS in production.");
  }

  if (/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(config.MONGODB_URI)) {
    failures.push("MONGODB_URI must not target a local host in production.");
  }

  if (failures.length > 0) {
    throw new EnvironmentConfigError(failures.join(" "));
  }
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
    .join(" ");
}

export function parseEnv(input: NodeJS.ProcessEnv): AppConfig {
  const result = envSchema.safeParse(input);

  if (!result.success) {
    throw new EnvironmentConfigError(
      `Invalid environment configuration. ${formatIssues(result.error)}`,
    );
  }

  assertProductionSafety(result.data);
  return Object.freeze(result.data);
}

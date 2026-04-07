import { z } from "zod";

/**
 * Environment variable schema with validation.
 * Fails fast at startup if required vars are missing or invalid.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid URL"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  JWT_REFRESH_SECRET: z.string().min(16, "JWT_REFRESH_SECRET must be at least 16 characters"),
  PORT: z
    .string()
    .default("3000")
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().min(1).max(65535)),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  ENGRAM_URL: z
    .string()
    .url()
    .optional()
    .default("http://localhost:7437"),
  ENGRAM_API_KEY: z
    .string()
    .optional(),
  ENGRAM_SYNC_ENABLED: z
    .string()
    .optional()
    .default("false")
    .transform((val) => val === "true" || val === "1")
    .pipe(z.boolean()),
  ENGRAM_POLL_INTERVAL_MS: z
    .string()
    .optional()
    .default("15000")
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().min(5000, "ENGRAM_POLL_INTERVAL_MS must be at least 5000")),
  COOKIE_SECRET: z
    .string()
    .optional(),
  RESEND_API_KEY: z
    .string()
    .optional(),
  EMAIL_FROM: z
    .string()
    .optional()
    .default("Kanon <noreply@kanon.dev>"),
  APP_URL: z
    .string()
    .optional()
    .default("http://localhost:5173"),
  CORS_ORIGIN: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      return val
        .split(",")
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0);
    })
    .pipe(
      z
        .array(
          z.string().refine(
            (origin) => {
              try {
                const url = new URL(origin);
                return url.protocol === "http:" || url.protocol === "https:";
              } catch {
                return false;
              }
            },
            { message: "Each CORS_ORIGIN must be a valid http/https URL" },
          ).refine(
            (origin) => !origin.includes("*"),
            { message: "Wildcards are not allowed in CORS_ORIGIN" },
          ),
        )
        .optional(),
    ),
});

/**
 * Production-only refinement: JWT secrets must be at least 32 characters
 * and must not be the default dev values.
 */
const envSchemaWithProductionChecks = envSchema.superRefine((data, ctx) => {
  if (data.NODE_ENV !== "production") return;

  const devDefaults = [
    "dev-jwt-secret-change-in-production",
    "dev-jwt-refresh-secret-change-in-production",
  ];

  if (data.JWT_SECRET.length < 32) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["JWT_SECRET"],
      message: "JWT_SECRET must be at least 32 characters in production",
    });
  }
  if (devDefaults.includes(data.JWT_SECRET)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["JWT_SECRET"],
      message: "JWT_SECRET must not use the default dev value in production",
    });
  }

  if (data.JWT_REFRESH_SECRET.length < 32) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["JWT_REFRESH_SECRET"],
      message: "JWT_REFRESH_SECRET must be at least 32 characters in production",
    });
  }
  if (devDefaults.includes(data.JWT_REFRESH_SECRET)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["JWT_REFRESH_SECRET"],
      message: "JWT_REFRESH_SECRET must not use the default dev value in production",
    });
  }
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parse and validate environment variables.
 * Throws a descriptive error if validation fails.
 */
function loadEnv(): Env {
  const result = envSchemaWithProductionChecks.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Environment validation failed:\n${formatted}`);
  }

  return result.data;
}

/**
 * Validated environment variables.
 * Lazily evaluated on first access so that test setup files can set
 * process.env before validation runs. This avoids the tight coupling
 * where importing any module that chains to env.ts would throw if
 * DATABASE_URL etc. were not yet set.
 */
let _env: Env | undefined;

export const env: Env = new Proxy({} as Env, {
  get(_target, prop: string) {
    if (!_env) {
      _env = loadEnv();
    }
    return _env[prop as keyof Env];
  },
});

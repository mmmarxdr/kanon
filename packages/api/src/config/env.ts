import { z } from "zod";

const TRUST_PROXY_PRESETS = new Set(["loopback", "linklocal", "uniquelocal"]);
// Permissive IP / CIDR token check (v4 or v6, optional /mask). Full validation
// is left to proxy-addr at boot; this just rejects obvious garbage early.
const IP_CIDR_TOKEN = /^[0-9a-fA-F:.]+(\/\d{1,3})?$/;

/**
 * Validate a string TRUST_PROXY value: a single proxy-addr preset, or a
 * comma-separated list of presets / IPs / CIDRs. Used to fail fast at boot on a
 * typo'd value, which would otherwise silently fall back to the socket IP and
 * re-break per-IP rate limiting (KAN-77).
 */
function isValidProxyTrust(val: string): boolean {
  const tokens = val.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
  if (tokens.length === 0) return false;
  return tokens.every((t) => TRUST_PROXY_PRESETS.has(t) || IP_CIDR_TOKEN.test(t));
}

/**
 * Environment variable schema with validation.
 * Fails fast at startup if required vars are missing or invalid.
 */
export const envSchema = z.object({
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
  // Reverse-proxy trust setting for client-IP resolution (KAN-77). This is what
  // `request.ip` (and the per-route auth rate limits keyed on it) resolves to.
  //
  // Default `loopback,uniquelocal` trusts the internal proxy hops (loopback +
  // the private docker network) and returns the first PUBLIC address from
  // X-Forwarded-For — i.e. the real client. Unlike a fixed hop count, this is
  // correct for BOTH deployment topologies (caddy → nginx → api = 2 hops, and
  // nginx → api = 1 hop) and resists X-Forwarded-For spoofing for public
  // clients, since the proxies append the true peer and proxy-addr stops at the
  // first public IP. Trusting loopback is harmless in prod (no external client
  // presents as 127.0.0.1) and keeps local/test traffic resolving its XFF.
  //
  // Accepts: a proxy-addr preset (`loopback` | `linklocal` | `uniquelocal`),
  // `true`/`false`, a hop count, or a comma-separated list of trusted IPs/CIDRs.
  TRUST_PROXY: z
    .string()
    .optional()
    .default("loopback,uniquelocal")
    .transform((val): boolean | number | string => {
      if (val === "true") return true;
      if (val === "false") return false;
      const n = Number(val);
      if (Number.isInteger(n) && n >= 0) return n;
      return val;
    })
    .pipe(
      z.union([
        z.boolean(),
        z.number().int().min(0),
        z
          .string()
          .refine(isValidProxyTrust, {
            message:
              "TRUST_PROXY must be true/false, a non-negative hop count, a preset (loopback|linklocal|uniquelocal), or a comma-separated list of IPs/CIDRs",
          }),
      ]),
    ),
  COOKIE_SECRET: z
    .string()
    .min(1, "COOKIE_SECRET must not be empty")
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
    .url("APP_URL must be a valid URL")
    .optional()
    .default("http://localhost:5173"),
  BASE_URL: z
    .string()
    .url("BASE_URL must be a valid URL")
    .optional()
    .default("http://localhost:3000"),
  ONBOARDING_TOKEN_TTL_HOURS: z
    .string()
    .optional()
    .default("72")
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().min(1).max(72)),
  SETUP_TOKEN_TTL_DAYS: z
    .string()
    .optional()
    .default("7")
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().min(1).max(365)),
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
export const envSchemaWithProductionChecks = envSchema.superRefine((data, ctx) => {
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

  if (!data.COOKIE_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["COOKIE_SECRET"],
      message: "COOKIE_SECRET is required in production",
    });
  } else if (data.COOKIE_SECRET.length < 32) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["COOKIE_SECRET"],
      message: "COOKIE_SECRET must be at least 32 characters in production",
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

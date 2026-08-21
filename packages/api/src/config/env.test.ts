import { describe, it, expect } from "vitest";
import { envSchema, envSchemaWithProductionChecks } from "./env.js";

// Baseline env that satisfies all required vars (non-prod and prod alike).
// Tests vary only the field under test to keep failures attributable.
const base = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/kanon",
  JWT_SECRET: "a".repeat(32),
  JWT_REFRESH_SECRET: "b".repeat(32),
  NODE_ENV: "production",
};

describe("envSchemaWithProductionChecks — COOKIE_SECRET in production", () => {
  it("fails when COOKIE_SECRET is missing in production", () => {
    const result = envSchemaWithProductionChecks.safeParse({ ...base });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("COOKIE_SECRET is required in production");
    }
  });

  it("fails when COOKIE_SECRET is shorter than 32 chars in production", () => {
    const result = envSchemaWithProductionChecks.safeParse({
      ...base,
      COOKIE_SECRET: "tooshort",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain(
        "COOKIE_SECRET must be at least 32 characters in production",
      );
    }
  });

  it("passes when COOKIE_SECRET is exactly 32 chars in production", () => {
    const result = envSchemaWithProductionChecks.safeParse({
      ...base,
      COOKIE_SECRET: "c".repeat(32),
    });
    // Only COOKIE_SECRET is being verified — other prod checks may also fire
    // but none should mention COOKIE_SECRET.
    if (!result.success) {
      const cookieIssues = result.error.issues.filter((i) =>
        i.path.includes("COOKIE_SECRET"),
      );
      expect(cookieIssues).toHaveLength(0);
    }
  });

  it("passes (no COOKIE_SECRET error) when NODE_ENV is development and COOKIE_SECRET is absent", () => {
    const result = envSchemaWithProductionChecks.safeParse({
      ...base,
      NODE_ENV: "development",
      // COOKIE_SECRET intentionally absent
    });
    if (!result.success) {
      const cookieIssues = result.error.issues.filter((i) =>
        i.path.includes("COOKIE_SECRET"),
      );
      expect(cookieIssues).toHaveLength(0);
    }
  });
});

describe("envSchema (base) — COOKIE_SECRET empty-string guard", () => {
  // The base schema uses z.string().min(1).optional():
  //   - absent (undefined)  → allowed at base level; production check enforces presence
  //   - empty string ("")   → rejected immediately (empty string is not undefined)
  //   - non-empty string    → allowed

  const baseValid = {
    DATABASE_URL: "postgresql://user:pass@localhost:5432/kanon",
    JWT_SECRET: "a".repeat(16),
    JWT_REFRESH_SECRET: "b".repeat(16),
  };

  it("rejects COOKIE_SECRET='' (empty string) at the base schema level", () => {
    const result = envSchema.safeParse({ ...baseValid, COOKIE_SECRET: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const cookieIssues = result.error.issues.filter((i) =>
        i.path.includes("COOKIE_SECRET"),
      );
      expect(cookieIssues.length).toBeGreaterThan(0);
      expect(cookieIssues[0].message).toBe("COOKIE_SECRET must not be empty");
    }
  });

  it("accepts absent COOKIE_SECRET at the base schema level (production check enforces presence)", () => {
    // undefined → .optional() passes; production superRefine handles the
    // absent-in-production case separately.
    const result = envSchema.safeParse({ ...baseValid });
    expect(result.success).toBe(true);
    if (!result.success) {
      const cookieIssues = result.error.issues.filter((i) =>
        i.path.includes("COOKIE_SECRET"),
      );
      expect(cookieIssues).toHaveLength(0);
    }
  });

  it("accepts a non-empty COOKIE_SECRET at the base schema level", () => {
    const result = envSchema.safeParse({ ...baseValid, COOKIE_SECRET: "any-non-empty-secret" });
    expect(result.success).toBe(true);
    if (!result.success) {
      const cookieIssues = result.error.issues.filter((i) =>
        i.path.includes("COOKIE_SECRET"),
      );
      expect(cookieIssues).toHaveLength(0);
    }
  });
});

// Observability slice 1: METRICS_TOKEN production guard
describe("envSchemaWithProductionChecks — METRICS_TOKEN in production", () => {
  const prodBase = {
    DATABASE_URL: "postgresql://user:pass@localhost:5432/kanon",
    JWT_SECRET: "a".repeat(32),
    JWT_REFRESH_SECRET: "b".repeat(32),
    COOKIE_SECRET: "c".repeat(32),
    NODE_ENV: "production",
  };

  it("fails when METRICS_TOKEN is absent in production", () => {
    const result = envSchemaWithProductionChecks.safeParse({ ...prodBase });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("METRICS_TOKEN is required in production");
    }
  });

  it("passes when METRICS_TOKEN is set in production", () => {
    const result = envSchemaWithProductionChecks.safeParse({
      ...prodBase,
      METRICS_TOKEN: "secret-token-value",
    });
    if (!result.success) {
      const tokenIssues = result.error.issues.filter((i) =>
        i.path.includes("METRICS_TOKEN"),
      );
      expect(tokenIssues).toHaveLength(0);
    } else {
      expect(result.success).toBe(true);
    }
  });

  it("passes (no METRICS_TOKEN error) in development without token", () => {
    const result = envSchemaWithProductionChecks.safeParse({
      DATABASE_URL: "postgresql://user:pass@localhost:5432/kanon",
      JWT_SECRET: "a".repeat(16),
      JWT_REFRESH_SECRET: "b".repeat(16),
      NODE_ENV: "development",
    });
    if (!result.success) {
      const tokenIssues = result.error.issues.filter((i) =>
        i.path.includes("METRICS_TOKEN"),
      );
      expect(tokenIssues).toHaveLength(0);
    }
  });
});

// KAN-102: forecast engine env vars
describe("envSchema — FORECAST_* env vars", () => {
  const base = {
    DATABASE_URL: "postgresql://user:pass@localhost:5432/kanon",
    JWT_SECRET: "a".repeat(16),
    JWT_REFRESH_SECRET: "b".repeat(16),
  };

  it("uses defaults when FORECAST_* vars are omitted", () => {
    const result = envSchema.parse({ ...base });
    expect(result.FORECAST_DEBOUNCE_MS).toBe(3000);
    expect(result.FORECAST_AT_RISK_BUFFER_DAYS).toBe(3);
    expect(result.FORECAST_HOURS_PER_DAY).toBe(8);
  });

  it("accepts a valid FORECAST_DEBOUNCE_MS override and returns a number", () => {
    const result = envSchema.parse({ ...base, FORECAST_DEBOUNCE_MS: "5000" });
    expect(result.FORECAST_DEBOUNCE_MS).toBe(5000);
  });

  it("rejects FORECAST_DEBOUNCE_MS below 100 (min guard)", () => {
    const result = envSchema.safeParse({ ...base, FORECAST_DEBOUNCE_MS: "50" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.includes("FORECAST_DEBOUNCE_MS"))).toBe(true);
    }
  });

  it("rejects FORECAST_AT_RISK_BUFFER_DAYS below 0 (min guard)", () => {
    const result = envSchema.safeParse({ ...base, FORECAST_AT_RISK_BUFFER_DAYS: "-1" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.includes("FORECAST_AT_RISK_BUFFER_DAYS"))).toBe(true);
    }
  });

  it("rejects FORECAST_HOURS_PER_DAY below 1 (min guard)", () => {
    const result = envSchema.safeParse({ ...base, FORECAST_HOURS_PER_DAY: "0" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.includes("FORECAST_HOURS_PER_DAY"))).toBe(true);
    }
  });

  it("rejects FORECAST_HOURS_PER_DAY above 24 (max guard)", () => {
    const result = envSchema.safeParse({ ...base, FORECAST_HOURS_PER_DAY: "25" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.includes("FORECAST_HOURS_PER_DAY"))).toBe(true);
    }
  });
});

describe("envSchema — comment rollout", () => {
  const base = { DATABASE_URL: "postgresql://user:pass@localhost:5432/kanon", JWT_SECRET: "a".repeat(16), JWT_REFRESH_SECRET: "b".repeat(16) };

  it("defaults capture off and only enables explicit true", () => {
    expect(envSchema.parse(base).INTEGRATION_COMMENT_CAPTURE_ENABLED).toBe(false);
    expect(envSchema.parse({ ...base, INTEGRATION_COMMENT_CAPTURE_ENABLED: "true" }).INTEGRATION_COMMENT_CAPTURE_ENABLED).toBe(true);
  });

  it("keeps triage capabilities off unless explicitly enabled", () => {
    expect(envSchema.parse(base).TRIAGE_SEARCH_ENABLED).toBe(false);
    expect(envSchema.parse(base).TRIAGE_PREVIEW_ENABLED).toBe(false);
    expect(envSchema.parse(base).TRIAGE_PROPOSAL_READS_ENABLED).toBe(false);
    expect(envSchema.parse(base).TRIAGE_PROPOSALS_ENABLED).toBe(false);
    expect(envSchema.parse(base).TRIAGE_DISMISS_ENABLED).toBe(false);
    expect(envSchema.parse(base).TRIAGE_RETENTION_ENABLED).toBe(false);
    expect(envSchema.parse({ ...base, TRIAGE_SEARCH_ENABLED: "true" }).TRIAGE_SEARCH_ENABLED).toBe(true);
    expect(envSchema.parse({ ...base, TRIAGE_PREVIEW_ENABLED: "true" }).TRIAGE_PREVIEW_ENABLED).toBe(true);
    expect(envSchema.parse({ ...base, TRIAGE_PROPOSAL_READS_ENABLED: "true" }).TRIAGE_PROPOSAL_READS_ENABLED).toBe(true);
    expect(envSchema.parse({ ...base, TRIAGE_PROPOSALS_ENABLED: "true" }).TRIAGE_PROPOSALS_ENABLED).toBe(true);
    expect(envSchema.parse({ ...base, TRIAGE_DISMISS_ENABLED: "true" }).TRIAGE_DISMISS_ENABLED).toBe(true);
    expect(envSchema.parse({ ...base, TRIAGE_RETENTION_ENABLED: "true" }).TRIAGE_RETENTION_ENABLED).toBe(true);
  });
});

describe("envSchema — REDMINE_ENDPOINT_ALLOWLIST", () => {
  const base = {
    DATABASE_URL: "postgresql://user:pass@localhost:5432/kanon",
    JWT_SECRET: "a".repeat(16),
    JWT_REFRESH_SECRET: "b".repeat(16),
  };

  it("leaves the private endpoint exception disabled when omitted", () => {
    expect(envSchema.parse(base).REDMINE_ENDPOINT_ALLOWLIST).toBeUndefined();
  });

  it("parses exact HTTP origins mapped to exact IP addresses", () => {
    const allowlist = { "http://redmine.internal.example": ["10.20.30.40"] };

    const result = envSchema.parse({
      ...base,
      REDMINE_ENDPOINT_ALLOWLIST: JSON.stringify(allowlist),
    });

    expect(result.REDMINE_ENDPOINT_ALLOWLIST).toEqual(allowlist);
  });

  it("canonicalizes equivalent IPv6 address spellings", () => {
    const result = envSchema.parse({
      ...base,
      REDMINE_ENDPOINT_ALLOWLIST: JSON.stringify({
        "http://redmine.internal.example": ["FD00:0:0:0:0:0:0:1"],
      }),
    });

    expect(result.REDMINE_ENDPOINT_ALLOWLIST).toEqual({
      "http://redmine.internal.example": ["fd00::1"],
    });
  });

  it.each([
    "not-json",
    JSON.stringify({ "https://redmine.internal.example": ["10.20.30.40"] }),
    JSON.stringify({ "http://redmine.internal.example/path": ["10.20.30.40"] }),
    JSON.stringify({ "http://redmine.internal.example": ["10.20.30.0/24"] }),
    JSON.stringify({
      "http://redmine.internal.example": ["0:0:0:0:0:ffff:192.168.1.100"],
    }),
    JSON.stringify({ "http://redmine.internal.example": [] }),
  ])("rejects malformed or broad policy %s", (policy) => {
    const result = envSchema.safeParse({ ...base, REDMINE_ENDPOINT_ALLOWLIST: policy });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join("."))).toContain(
        "REDMINE_ENDPOINT_ALLOWLIST",
      );
    }
  });
});

describe("envSchema — audit operations", () => {
  const base = {
    DATABASE_URL: "postgresql://user:pass@localhost:5432/kanon",
    JWT_SECRET: "a".repeat(16),
    JWT_REFRESH_SECRET: "b".repeat(16),
  };

  it("keeps polling audits disabled and uses bounded operational defaults", () => {
    const audit = envSchema.parse(base);

    expect(audit.INTEGRATION_AUDIT_ENABLED).toBe(false);
    expect(audit.INTEGRATION_AUDIT_CADENCE_MS).toBe(300_000);
    expect(audit.INTEGRATION_AUDIT_MAX_PASSES).toBe(2);
    expect(audit.INTEGRATION_AUDIT_PAGE_SIZE).toBe(100);
    expect(audit.INTEGRATION_AUDIT_TIMEOUT_MS).toBe(30_000);
    expect(audit.INTEGRATION_AUDIT_FRESHNESS_MS).toBe(300_000);
    expect(audit.INTEGRATION_AUDIT_RETENTION_DAYS).toBe(30);
    expect(audit.INTEGRATION_AUDIT_MAX_BINDINGS).toBe(1);
  });

  it("accepts explicit audit enablement and rejects invalid gate values", () => {
    expect(envSchema.parse({ ...base, INTEGRATION_AUDIT_ENABLED: "true" }).INTEGRATION_AUDIT_ENABLED)
      .toBe(true);
    expect(envSchema.safeParse({ ...base, INTEGRATION_AUDIT_ENABLED: "yes" }).success).toBe(false);
  });

  it("accepts configured safe audit limits and rejects unbounded values", () => {
    const configured = envSchema.parse({
      ...base,
      INTEGRATION_AUDIT_CADENCE_MS: "60000",
      INTEGRATION_AUDIT_MAX_PASSES: "3",
      INTEGRATION_AUDIT_PAGE_SIZE: "50",
      INTEGRATION_AUDIT_TIMEOUT_MS: "1000",
      INTEGRATION_AUDIT_FRESHNESS_MS: "60000",
      INTEGRATION_AUDIT_RETENTION_DAYS: "60",
      INTEGRATION_AUDIT_MAX_BINDINGS: "2",
    });
    expect(configured.INTEGRATION_AUDIT_MAX_BINDINGS).toBe(2);
    expect(configured.INTEGRATION_AUDIT_RETENTION_DAYS).toBe(60);

    expect(envSchema.safeParse({ ...base, INTEGRATION_AUDIT_MAX_BINDINGS: "0" }).success).toBe(false);
    expect(envSchema.safeParse({ ...base, INTEGRATION_AUDIT_PAGE_SIZE: "101" }).success).toBe(false);
  });
});

describe("envSchema — privacy quarantine keyring", () => {
  const base = {
    DATABASE_URL: "postgresql://user:pass@localhost:5432/kanon",
    JWT_SECRET: "a".repeat(16),
    JWT_REFRESH_SECRET: "b".repeat(16),
  };

  it("accepts a current AES-256 key and retained historical key", () => {
    const current = Buffer.alloc(32, 1).toString("base64");
    const old = Buffer.alloc(32, 2).toString("base64");
    expect(envSchema.parse({ ...base, PRIVACY_QUARANTINE_KEYRING: JSON.stringify({ currentKeyId: "v2", keys: { v1: old, v2: current } }) }).PRIVACY_QUARANTINE_KEYRING)
      .toEqual({ currentKeyId: "v2", keys: { v1: old, v2: current } });
  });

  it("rejects a keyring whose current key is absent or invalid", () => {
    expect(envSchema.safeParse({ ...base, PRIVACY_QUARANTINE_KEYRING: JSON.stringify({ currentKeyId: "v2", keys: { v1: "not-a-key" } }) }).success).toBe(false);
  });
});

describe("envSchema — production database principals", () => {
  it("requires a separate privacy operator URL in production", () => {
    const result = envSchemaWithProductionChecks.safeParse({
      ...base,
      COOKIE_SECRET: "c".repeat(32),
      METRICS_TOKEN: "metrics-token",
      DATABASE_URL: "postgresql://kanon_runtime:runtime-password@db:5432/kanon",
      POSTGRES_OWNER_DATABASE_URL: "postgresql://owner:owner-password@db:5432/kanon",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((issue) => issue.path.join("."))).toContain("PRIVACY_OPERATOR_DATABASE_URL");
  });

  it("rejects an operator URL that reuses the runtime login", () => {
    const result = envSchemaWithProductionChecks.safeParse({
      ...base,
      COOKIE_SECRET: "c".repeat(32),
      METRICS_TOKEN: "metrics-token",
      DATABASE_URL: "postgresql://kanon_runtime:runtime-password@db:5432/kanon",
      POSTGRES_OWNER_DATABASE_URL: "postgresql://owner:owner-password@db:5432/kanon",
      PRIVACY_OPERATOR_DATABASE_URL: "postgresql://kanon_runtime:operator-password@db:5432/kanon",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((issue) => issue.message)).toContain("Database principal URLs must use distinct login names");
  });
});

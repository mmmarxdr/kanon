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

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

import { describe, it, expect } from "vitest";
import { envSchemaWithProductionChecks } from "./env.js";

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

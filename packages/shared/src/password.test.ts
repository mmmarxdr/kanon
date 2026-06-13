import { describe, it, expect } from "vitest";
import { passwordSchema, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH, PASSWORD_REQUIREMENTS } from "./password.js";

describe("passwordSchema", () => {
  it("accepts a 12+ char password with full complexity", () => {
    expect(passwordSchema.safeParse("SecretPass1!").success).toBe(true);
  });

  it("rejects a password shorter than 12 characters", () => {
    // 11 chars, otherwise fully complex — fails only on length
    const result = passwordSchema.safeParse("SecretPas1!");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => /12/.test(i.message))).toBe(true);
    }
  });

  it("rejects a password longer than 128 characters", () => {
    expect(passwordSchema.safeParse("A1!a" + "x".repeat(125)).success).toBe(false);
  });

  it("rejects a password with no uppercase letter", () => {
    const result = passwordSchema.safeParse("secretpass1!");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => /upper/i.test(i.message))).toBe(true);
    }
  });

  it("rejects a password with no lowercase letter", () => {
    const result = passwordSchema.safeParse("SECRETPASS1!");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => /lower/i.test(i.message))).toBe(true);
    }
  });

  it("rejects a password with no digit", () => {
    const result = passwordSchema.safeParse("SecretPass!!");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => /digit|number/i.test(i.message))).toBe(true);
    }
  });

  it("rejects a password with no symbol", () => {
    const result = passwordSchema.safeParse("SecretPass12");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => /symbol|special/i.test(i.message))).toBe(true);
    }
  });

  it("does not count whitespace as a symbol", () => {
    // 12 chars with upper/lower/digit, but the only non-alphanumeric is a space
    const result = passwordSchema.safeParse("Secret Pass1");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => /symbol|special/i.test(i.message))).toBe(true);
    }
  });

  it("exposes the length bounds as constants", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12);
    expect(PASSWORD_MAX_LENGTH).toBe(128);
  });
});

describe("PASSWORD_REQUIREMENTS consistency with passwordSchema", () => {
  const COMPLIANT = "SecretPass1!";

  it("a password meeting every requirement also passes passwordSchema", () => {
    const allMet = PASSWORD_REQUIREMENTS.every((r) => r.test(COMPLIANT));
    expect(allMet).toBe(true);
    expect(passwordSchema.safeParse(COMPLIANT).success).toBe(true);
  });

  it("min-length: failing the requirement also fails passwordSchema", () => {
    // 11 chars, otherwise fully complex
    const pw = "SecretPas1!";
    const req = PASSWORD_REQUIREMENTS.find((r) => r.id === "min-length")!;
    expect(req.test(pw)).toBe(false);
    expect(passwordSchema.safeParse(pw).success).toBe(false);
  });

  it("uppercase: failing the requirement also fails passwordSchema", () => {
    // All lowercase equivalent — 12 chars
    const pw = "secretpass1!";
    const req = PASSWORD_REQUIREMENTS.find((r) => r.id === "uppercase")!;
    expect(req.test(pw)).toBe(false);
    expect(passwordSchema.safeParse(pw).success).toBe(false);
  });

  it("lowercase: failing the requirement also fails passwordSchema", () => {
    const pw = "SECRETPASS1!";
    const req = PASSWORD_REQUIREMENTS.find((r) => r.id === "lowercase")!;
    expect(req.test(pw)).toBe(false);
    expect(passwordSchema.safeParse(pw).success).toBe(false);
  });

  it("digit: failing the requirement also fails passwordSchema", () => {
    const pw = "SecretPass!!";
    const req = PASSWORD_REQUIREMENTS.find((r) => r.id === "digit")!;
    expect(req.test(pw)).toBe(false);
    expect(passwordSchema.safeParse(pw).success).toBe(false);
  });

  it("symbol: failing the requirement also fails passwordSchema", () => {
    const pw = "SecretPass12";
    const req = PASSWORD_REQUIREMENTS.find((r) => r.id === "symbol")!;
    expect(req.test(pw)).toBe(false);
    expect(passwordSchema.safeParse(pw).success).toBe(false);
  });

  it("symbol: whitespace does not satisfy the symbol requirement (matches schema)", () => {
    const pw = "Secret Pass1";
    const req = PASSWORD_REQUIREMENTS.find((r) => r.id === "symbol")!;
    expect(req.test(pw)).toBe(false);
    expect(passwordSchema.safeParse(pw).success).toBe(false);
  });

  it("PASSWORD_REQUIREMENTS covers all 5 policy dimensions", () => {
    const ids = PASSWORD_REQUIREMENTS.map((r) => r.id);
    expect(ids).toContain("min-length");
    expect(ids).toContain("uppercase");
    expect(ids).toContain("lowercase");
    expect(ids).toContain("digit");
    expect(ids).toContain("symbol");
    expect(ids).toHaveLength(5);
  });
});

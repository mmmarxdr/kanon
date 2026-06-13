import { describe, it, expect } from "vitest";
import { passwordSchema, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from "./password.js";

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

  it("exposes the length bounds as constants", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12);
    expect(PASSWORD_MAX_LENGTH).toBe(128);
  });
});

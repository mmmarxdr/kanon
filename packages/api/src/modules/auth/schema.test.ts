import { describe, it, expect } from "vitest";
import {
  RegisterBody,
  LoginBody,
  RefreshBody,
  ResetPasswordBody,
  ChangePasswordBody,
} from "./schema.js";

describe("Auth Zod Schemas", () => {
  // ── RegisterBody ─────────────────────────────────────────────────────

  describe("RegisterBody", () => {
    // Valid password: 12+ chars with upper, lower, digit, and symbol
    const validData = {
      email: "test@kanon.io",
      password: "SecretPass1!",
    };

    it("accepts valid registration data (email + password only)", () => {
      const result = RegisterBody.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it("accepts optional displayName", () => {
      const result = RegisterBody.safeParse({
        ...validData,
        displayName: "Test User",
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid email", () => {
      const result = RegisterBody.safeParse({ ...validData, email: "not-an-email" });
      expect(result.success).toBe(false);
    });

    it("rejects empty email", () => {
      const result = RegisterBody.safeParse({ ...validData, email: "" });
      expect(result.success).toBe(false);
    });

    // ── Password complexity (KAN-49) ──────────────────────────────────

    it("rejects password shorter than 12 chars", () => {
      // 11 chars, has upper/lower/digit/symbol — fails only min length
      const result = RegisterBody.safeParse({ ...validData, password: "SecretPas1!" });
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message);
        expect(messages.some((m) => /12/.test(m))).toBe(true);
      }
    });

    it("rejects password longer than 128 chars", () => {
      const result = RegisterBody.safeParse({
        ...validData,
        password: "A1!a" + "x".repeat(125),
      });
      expect(result.success).toBe(false);
    });

    it("rejects password with no uppercase letter", () => {
      // 12 chars, lower/digit/symbol, no upper
      const result = RegisterBody.safeParse({ ...validData, password: "secretpass1!" });
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message);
        expect(messages.some((m) => /upper/i.test(m))).toBe(true);
      }
    });

    it("rejects password with no lowercase letter", () => {
      // 12 chars, upper/digit/symbol, no lower
      const result = RegisterBody.safeParse({ ...validData, password: "SECRETPASS1!" });
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message);
        expect(messages.some((m) => /lower/i.test(m))).toBe(true);
      }
    });

    it("rejects password with no digit", () => {
      // 12 chars, upper/lower/symbol, no digit
      const result = RegisterBody.safeParse({ ...validData, password: "SecretPass!!" });
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message);
        expect(messages.some((m) => /digit|number/i.test(m))).toBe(true);
      }
    });

    it("rejects password with no symbol", () => {
      // 12 chars, upper/lower/digit, no symbol
      const result = RegisterBody.safeParse({ ...validData, password: "SecretPass12" });
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message);
        expect(messages.some((m) => /symbol|special/i.test(m))).toBe(true);
      }
    });

    it("rejects missing fields", () => {
      const result = RegisterBody.safeParse({});
      expect(result.success).toBe(false);
    });

    it("does not require workspaceId", () => {
      // workspaceId is not part of the schema at all
      const result = RegisterBody.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it("does not require username", () => {
      // username is not part of the schema
      const result = RegisterBody.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it("rejects displayName longer than 100 chars", () => {
      const result = RegisterBody.safeParse({
        ...validData,
        displayName: "a".repeat(101),
      });
      expect(result.success).toBe(false);
    });
  });

  // ── LoginBody ────────────────────────────────────────────────────────

  describe("LoginBody", () => {
    const validData = {
      email: "test@kanon.io",
      password: "Secret123!",
    };

    it("accepts valid login data (email + password only)", () => {
      const result = LoginBody.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it("rejects invalid email", () => {
      const result = LoginBody.safeParse({ ...validData, email: "bad" });
      expect(result.success).toBe(false);
    });

    it("rejects empty password", () => {
      const result = LoginBody.safeParse({ ...validData, password: "" });
      expect(result.success).toBe(false);
    });

    it("does not require workspaceId", () => {
      // No workspace field in LoginBody
      const result = LoginBody.safeParse(validData);
      expect(result.success).toBe(true);
    });
  });

  // ── RefreshBody ──────────────────────────────────────────────────────

  describe("RefreshBody", () => {
    it("accepts valid refresh token", () => {
      const result = RefreshBody.safeParse({ refreshToken: "some.jwt.token" });
      expect(result.success).toBe(true);
    });

    it("rejects empty refresh token", () => {
      const result = RefreshBody.safeParse({ refreshToken: "" });
      expect(result.success).toBe(false);
    });

    it("rejects missing refresh token", () => {
      const result = RefreshBody.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  // ── ResetPasswordBody (KAN-50) ───────────────────────────────────────
  // newPassword must satisfy the same shared policy as register.

  describe("ResetPasswordBody", () => {
    it("accepts a valid token + strong newPassword", () => {
      const result = ResetPasswordBody.safeParse({
        token: "reset-token",
        newPassword: "SecretPass1!",
      });
      expect(result.success).toBe(true);
    });

    it("rejects a weak newPassword (too short)", () => {
      const result = ResetPasswordBody.safeParse({
        token: "reset-token",
        newPassword: "SecretPas1!", // 11 chars
      });
      expect(result.success).toBe(false);
    });

    it("rejects a newPassword with no symbol", () => {
      const result = ResetPasswordBody.safeParse({
        token: "reset-token",
        newPassword: "SecretPass12",
      });
      expect(result.success).toBe(false);
    });

    it("rejects an empty token", () => {
      const result = ResetPasswordBody.safeParse({
        token: "",
        newPassword: "SecretPass1!",
      });
      expect(result.success).toBe(false);
    });
  });

  // ── ChangePasswordBody (KAN-50) ──────────────────────────────────────
  // newPassword must satisfy the shared policy; currentPassword only non-empty.

  describe("ChangePasswordBody", () => {
    it("accepts a current password + strong newPassword", () => {
      const result = ChangePasswordBody.safeParse({
        currentPassword: "whatever-current",
        newPassword: "SecretPass1!",
      });
      expect(result.success).toBe(true);
    });

    it("rejects a weak newPassword (too short)", () => {
      const result = ChangePasswordBody.safeParse({
        currentPassword: "whatever-current",
        newPassword: "SecretPas1!", // 11 chars
      });
      expect(result.success).toBe(false);
    });

    it("rejects a newPassword with no symbol", () => {
      const result = ChangePasswordBody.safeParse({
        currentPassword: "whatever-current",
        newPassword: "SecretPass12",
      });
      expect(result.success).toBe(false);
    });

    it("rejects an empty currentPassword", () => {
      const result = ChangePasswordBody.safeParse({
        currentPassword: "",
        newPassword: "SecretPass1!",
      });
      expect(result.success).toBe(false);
    });
  });
});

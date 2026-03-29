import { describe, it, expect } from "vitest";
import { RegisterBody, LoginBody, RefreshBody } from "./schema.js";

describe("Auth Zod Schemas", () => {
  // ── RegisterBody ─────────────────────────────────────────────────────

  describe("RegisterBody", () => {
    const validData = {
      email: "test@kanon.io",
      password: "Secret123!",
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

    it("rejects password shorter than 8 chars", () => {
      const result = RegisterBody.safeParse({ ...validData, password: "short" });
      expect(result.success).toBe(false);
    });

    it("rejects password longer than 128 chars", () => {
      const result = RegisterBody.safeParse({
        ...validData,
        password: "x".repeat(129),
      });
      expect(result.success).toBe(false);
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
});

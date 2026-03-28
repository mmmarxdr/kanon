import { describe, it, expect } from "vitest";
import { RegisterBody, LoginBody, RefreshBody } from "./schema.js";

describe("Auth Zod Schemas", () => {
  // ── RegisterBody ─────────────────────────────────────────────────────

  describe("RegisterBody", () => {
    const validData = {
      email: "test@kanon.io",
      username: "testuser",
      password: "Secret123!",
      workspaceId: "550e8400-e29b-41d4-a716-446655440000",
    };

    it("accepts valid registration data", () => {
      const result = RegisterBody.safeParse(validData);
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

    it("rejects username shorter than 2 chars", () => {
      const result = RegisterBody.safeParse({ ...validData, username: "a" });
      expect(result.success).toBe(false);
    });

    it("rejects username longer than 50 chars", () => {
      const result = RegisterBody.safeParse({
        ...validData,
        username: "a".repeat(51),
      });
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

    it("rejects invalid workspace UUID", () => {
      const result = RegisterBody.safeParse({
        ...validData,
        workspaceId: "not-a-uuid",
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing fields", () => {
      const result = RegisterBody.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  // ── LoginBody ────────────────────────────────────────────────────────

  describe("LoginBody", () => {
    const validData = {
      email: "test@kanon.io",
      password: "Secret123!",
      workspaceId: "550e8400-e29b-41d4-a716-446655440000",
    };

    it("accepts valid login data", () => {
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

    it("accepts workspace slug instead of UUID", () => {
      const result = LoginBody.safeParse({
        ...validData,
        workspaceId: "kanon-dev",
      });
      expect(result.success).toBe(true);
    });

    it("rejects empty workspace identifier", () => {
      const result = LoginBody.safeParse({
        ...validData,
        workspaceId: "",
      });
      expect(result.success).toBe(false);
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

import { describe, it, expect } from "vitest";
import jwt from "jsonwebtoken";
import {
  hashPassword,
  verifyPassword,
  signTokens,
  verifyRefreshToken,
} from "./service.js";
import { AppError } from "../../shared/types.js";

describe("Auth Service — unit tests (no DB)", () => {
  // ── Password hashing ───────────────────────────────────────────────

  describe("hashPassword / verifyPassword", () => {
    it("hashes a password and verifies it", async () => {
      const hash = await hashPassword("Secret123!");
      expect(hash).not.toBe("Secret123!");
      expect(hash.startsWith("$2")).toBe(true); // bcrypt prefix

      const valid = await verifyPassword("Secret123!", hash);
      expect(valid).toBe(true);
    });

    it("rejects wrong password", async () => {
      const hash = await hashPassword("Secret123!");
      const valid = await verifyPassword("WrongPassword!", hash);
      expect(valid).toBe(false);
    });

    it("produces different hashes for the same input (salted)", async () => {
      const h1 = await hashPassword("Secret123!");
      const h2 = await hashPassword("Secret123!");
      expect(h1).not.toBe(h2);
    });
  });

  // ── Token signing ─────────────────────────────────────────────────

  describe("signTokens", () => {
    it("returns accessToken and refreshToken", () => {
      const result = signTokens({
        sub: "user-1",
        email: "user@kanon.io",
      });

      expect(result).toHaveProperty("accessToken");
      expect(result).toHaveProperty("refreshToken");
      expect(typeof result.accessToken).toBe("string");
      expect(typeof result.refreshToken).toBe("string");
    });

    it("access token contains expected payload (sub + email only)", () => {
      const { accessToken } = signTokens({
        sub: "user-1",
        email: "user@kanon.io",
      });

      const decoded = jwt.decode(accessToken) as Record<string, unknown>;
      expect(decoded["sub"]).toBe("user-1");
      expect(decoded["email"]).toBe("user@kanon.io");
      expect(decoded).toHaveProperty("exp");
      // Must NOT contain workspace or role
      expect(decoded).not.toHaveProperty("workspaceId");
      expect(decoded).not.toHaveProperty("role");
    });

    it("refresh token contains expected payload", () => {
      const { refreshToken } = signTokens({
        sub: "user-1",
        email: "user@kanon.io",
      });

      const decoded = jwt.decode(refreshToken) as Record<string, unknown>;
      expect(decoded["sub"]).toBe("user-1");
      expect(decoded["email"]).toBe("user@kanon.io");
      // Must NOT contain workspace or role
      expect(decoded).not.toHaveProperty("workspaceId");
      expect(decoded).not.toHaveProperty("role");
    });
  });

  // ── Refresh token verification ────────────────────────────────────

  describe("verifyRefreshToken", () => {
    it("verifies a valid refresh token", () => {
      const { refreshToken } = signTokens({
        sub: "user-1",
        email: "user@kanon.io",
      });

      const payload = verifyRefreshToken(refreshToken);
      expect(payload.sub).toBe("user-1");
      expect(payload.email).toBe("user@kanon.io");
    });

    it("throws AppError for invalid token", () => {
      expect(() => verifyRefreshToken("invalid.jwt.token")).toThrow(AppError);

      try {
        verifyRefreshToken("invalid.jwt.token");
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(401);
        expect((err as AppError).code).toBe("INVALID_REFRESH_TOKEN");
      }
    });

    it("throws AppError for token signed with wrong secret", () => {
      const fakeToken = jwt.sign(
        { sub: "user-1", email: "user@kanon.io" },
        "wrong-secret-that-is-long-enough",
        { expiresIn: "7d" },
      );

      expect(() => verifyRefreshToken(fakeToken)).toThrow(AppError);
    });
  });
});

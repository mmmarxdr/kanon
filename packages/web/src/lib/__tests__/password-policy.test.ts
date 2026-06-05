import { describe, it, expect } from "vitest";
import { evaluatePassword, isPasswordValid } from "../password-policy";

describe("evaluatePassword", () => {
  describe("min-length requirement", () => {
    it("is unmet for a 7-character password", () => {
      const reqs = evaluatePassword("1234567", "");
      const item = reqs.find((r) => r.id === "min-length");
      expect(item).toBeDefined();
      expect(item!.met).toBe(false);
    });

    it("is met for an 8-character password (lower boundary)", () => {
      const reqs = evaluatePassword("12345678", "");
      const item = reqs.find((r) => r.id === "min-length");
      expect(item!.met).toBe(true);
    });
  });

  describe("max-length requirement", () => {
    it("is met for a 128-character password (upper boundary)", () => {
      const pw = "a".repeat(128);
      const reqs = evaluatePassword(pw, pw);
      const item = reqs.find((r) => r.id === "max-length");
      expect(item!.met).toBe(true);
    });

    it("is unmet for a 129-character password", () => {
      const pw = "a".repeat(129);
      const reqs = evaluatePassword(pw, pw);
      const item = reqs.find((r) => r.id === "max-length");
      expect(item!.met).toBe(false);
    });
  });

  describe("match requirement", () => {
    it("is met when password equals confirm (non-empty)", () => {
      const reqs = evaluatePassword("mypassword", "mypassword");
      const item = reqs.find((r) => r.id === "match");
      expect(item!.met).toBe(true);
    });

    it("is unmet when password does not equal confirm", () => {
      const reqs = evaluatePassword("mypassword", "different");
      const item = reqs.find((r) => r.id === "match");
      expect(item!.met).toBe(false);
    });

    it("is unmet when confirm is empty string", () => {
      const reqs = evaluatePassword("mypassword", "");
      const item = reqs.find((r) => r.id === "match");
      expect(item!.met).toBe(false);
    });
  });
});

describe("isPasswordValid", () => {
  it("returns true only when all requirements are met", () => {
    const pw = "validpass";
    const reqs = evaluatePassword(pw, pw);
    expect(isPasswordValid(reqs)).toBe(true);
  });

  it("returns false when min-length is unmet", () => {
    const reqs = evaluatePassword("short", "short");
    expect(isPasswordValid(reqs)).toBe(false);
  });

  it("returns false when match is unmet", () => {
    const reqs = evaluatePassword("goodpassword", "different");
    expect(isPasswordValid(reqs)).toBe(false);
  });

  it("returns false when max-length is unmet", () => {
    const pw = "a".repeat(129);
    const reqs = evaluatePassword(pw, pw);
    expect(isPasswordValid(reqs)).toBe(false);
  });
});

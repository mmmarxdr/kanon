import { describe, it, expect } from "vitest";
import { evaluatePassword, isPasswordValid } from "../password-policy";

// Compliant password used throughout — meets all 5 complexity requirements.
const VALID_PW = "SecretPass1!";

describe("evaluatePassword", () => {
  describe("min-length requirement", () => {
    it("is unmet for an 11-character password", () => {
      const reqs = evaluatePassword("SecretPas1!", "");
      const item = reqs.find((r) => r.id === "min-length");
      expect(item).toBeDefined();
      expect(item!.met).toBe(false);
    });

    it("is met for a 12-character password (lower boundary)", () => {
      const reqs = evaluatePassword(VALID_PW, "");
      const item = reqs.find((r) => r.id === "min-length");
      expect(item!.met).toBe(true);
    });

    it("label reads '12 characters' (not 8)", () => {
      const reqs = evaluatePassword("", "");
      const item = reqs.find((r) => r.id === "min-length");
      expect(item!.label).toMatch(/12/);
    });
  });

  describe("uppercase requirement", () => {
    it("is unmet for all-lowercase password", () => {
      const reqs = evaluatePassword("secretpass1!", "");
      const item = reqs.find((r) => r.id === "uppercase");
      expect(item).toBeDefined();
      expect(item!.met).toBe(false);
    });

    it("is met when password has at least one uppercase letter", () => {
      const reqs = evaluatePassword(VALID_PW, "");
      const item = reqs.find((r) => r.id === "uppercase");
      expect(item!.met).toBe(true);
    });
  });

  describe("lowercase requirement", () => {
    it("is unmet for all-uppercase password", () => {
      const reqs = evaluatePassword("SECRETPASS1!", "");
      const item = reqs.find((r) => r.id === "lowercase");
      expect(item).toBeDefined();
      expect(item!.met).toBe(false);
    });

    it("is met when password has at least one lowercase letter", () => {
      const reqs = evaluatePassword(VALID_PW, "");
      const item = reqs.find((r) => r.id === "lowercase");
      expect(item!.met).toBe(true);
    });
  });

  describe("digit requirement", () => {
    it("is unmet for password with no digit", () => {
      const reqs = evaluatePassword("SecretPass!!", "");
      const item = reqs.find((r) => r.id === "digit");
      expect(item).toBeDefined();
      expect(item!.met).toBe(false);
    });

    it("is met when password has at least one digit", () => {
      const reqs = evaluatePassword(VALID_PW, "");
      const item = reqs.find((r) => r.id === "digit");
      expect(item!.met).toBe(true);
    });
  });

  describe("symbol requirement", () => {
    it("is unmet for password with no symbol", () => {
      const reqs = evaluatePassword("SecretPass12", "");
      const item = reqs.find((r) => r.id === "symbol");
      expect(item).toBeDefined();
      expect(item!.met).toBe(false);
    });

    it("is met when password has at least one symbol", () => {
      const reqs = evaluatePassword(VALID_PW, "");
      const item = reqs.find((r) => r.id === "symbol");
      expect(item!.met).toBe(true);
    });

    it("whitespace does not count as a symbol", () => {
      // 12 chars, upper+lower+digit, but the non-alphanumeric is a space
      const reqs = evaluatePassword("Secret Pass1", "");
      const item = reqs.find((r) => r.id === "symbol");
      expect(item!.met).toBe(false);
    });
  });

  describe("max-length requirement", () => {
    it("is met for a 128-character password (upper boundary)", () => {
      const pw = "A1!" + "a".repeat(125);
      const reqs = evaluatePassword(pw, pw);
      const item = reqs.find((r) => r.id === "max-length");
      expect(item!.met).toBe(true);
    });

    it("is unmet for a 129-character password", () => {
      const pw = "A1!" + "a".repeat(126);
      const reqs = evaluatePassword(pw, pw);
      const item = reqs.find((r) => r.id === "max-length");
      expect(item!.met).toBe(false);
    });
  });

  describe("match requirement", () => {
    it("is met when password equals confirm (non-empty)", () => {
      const reqs = evaluatePassword(VALID_PW, VALID_PW);
      const item = reqs.find((r) => r.id === "match");
      expect(item!.met).toBe(true);
    });

    it("is unmet when password does not equal confirm", () => {
      const reqs = evaluatePassword(VALID_PW, "different");
      const item = reqs.find((r) => r.id === "match");
      expect(item!.met).toBe(false);
    });

    it("is unmet when confirm is empty string", () => {
      const reqs = evaluatePassword(VALID_PW, "");
      const item = reqs.find((r) => r.id === "match");
      expect(item!.met).toBe(false);
    });
  });

  describe("requirement list shape", () => {
    it("includes all 5 complexity ids plus max-length and match", () => {
      const reqs = evaluatePassword("", "");
      const ids = reqs.map((r) => r.id);
      expect(ids).toContain("min-length");
      expect(ids).toContain("uppercase");
      expect(ids).toContain("lowercase");
      expect(ids).toContain("digit");
      expect(ids).toContain("symbol");
      expect(ids).toContain("max-length");
      expect(ids).toContain("match");
      expect(ids).toHaveLength(7);
    });

    it("match is the last item", () => {
      const reqs = evaluatePassword("", "");
      const last = reqs.at(-1);
      expect(last?.id).toBe("match");
    });
  });
});

describe("isPasswordValid", () => {
  it("returns true only when all requirements are met", () => {
    const reqs = evaluatePassword(VALID_PW, VALID_PW);
    expect(isPasswordValid(reqs)).toBe(true);
  });

  it("returns false when min-length is unmet", () => {
    const reqs = evaluatePassword("Short1!", "Short1!");
    expect(isPasswordValid(reqs)).toBe(false);
  });

  it("returns false when match is unmet", () => {
    const reqs = evaluatePassword(VALID_PW, "different");
    expect(isPasswordValid(reqs)).toBe(false);
  });

  it("returns false when max-length is unmet", () => {
    const pw = "A1!" + "a".repeat(126); // 129 chars
    const reqs = evaluatePassword(pw, pw);
    expect(isPasswordValid(reqs)).toBe(false);
  });

  it("returns false when uppercase is unmet", () => {
    const reqs = evaluatePassword("secretpass1!", "secretpass1!");
    expect(isPasswordValid(reqs)).toBe(false);
  });

  it("returns false when symbol is unmet", () => {
    const reqs = evaluatePassword("SecretPass12", "SecretPass12");
    expect(isPasswordValid(reqs)).toBe(false);
  });
});

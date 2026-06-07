// ─── via normalization unit tests (S1 / task 1.1) ───────────────────────────

import { describe, it, expect } from "vitest";
import { normalizeVia, VIA } from "./via.js";

describe("normalizeVia", () => {
  it("returns known value: claude-code", () => {
    expect(normalizeVia("claude-code")).toBe("claude-code");
  });

  it("returns known value: cursor", () => {
    expect(normalizeVia("cursor")).toBe("cursor");
  });

  it("returns known value: antigravity", () => {
    expect(normalizeVia("antigravity")).toBe("antigravity");
  });

  it("returns known value: web", () => {
    expect(normalizeVia("web")).toBe("web");
  });

  it("returns known value: cli", () => {
    expect(normalizeVia("cli")).toBe("cli");
  });

  it("returns null for unknown value", () => {
    expect(normalizeVia("unknown-bot")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(normalizeVia("")).toBeNull();
  });

  it("returns null when value is undefined (absent header)", () => {
    expect(normalizeVia(undefined)).toBeNull();
  });

  it("VIA const array contains all known values", () => {
    expect(VIA).toEqual(
      expect.arrayContaining(["claude-code", "cursor", "antigravity", "web", "cli"]),
    );
    expect(VIA).toHaveLength(5);
  });
});

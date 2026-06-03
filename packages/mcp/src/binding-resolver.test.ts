// ─── binding-resolver — pure projectKey resolution tests ─────────────────────
//
// Tests for the pure resolveProjectKey function that merges:
//   1. Explicit tool-call argument (highest priority)
//   2. .kanon binding from walk-up (fallback)
//
// These tests do NOT mock the MCP server — per Extract-Before-Mock rule.

import { describe, it, expect } from "vitest";
import { resolveProjectKey } from "./binding-resolver.js";
import type { KanonBinding } from "./kanon-binding.js";

const binding: KanonBinding = {
  projectKey: "KAN",
  workspaceId: "ws_abc",
  apiUrl: "https://api.example.com",
};

describe("resolveProjectKey", () => {
  // ── explicit always wins ──────────────────────────────────────────────────

  it("returns the explicit projectKey when provided, ignoring binding", () => {
    const result = resolveProjectKey("EXPLICIT", binding);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.projectKey).toBe("EXPLICIT");
  });

  it("returns the explicit projectKey even when binding is null", () => {
    const result = resolveProjectKey("EXPLICIT", null);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.projectKey).toBe("EXPLICIT");
  });

  // ── binding fallback ──────────────────────────────────────────────────────

  it("falls back to binding.projectKey when explicit is undefined", () => {
    const result = resolveProjectKey(undefined, binding);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.projectKey).toBe("KAN");
  });

  it("returns error when both explicit is absent and binding is null", () => {
    const result = resolveProjectKey(undefined, null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("projectKey");
      expect(result.error).toContain(".kanon");
    }
  });

  it("returns error when explicit is empty string and no binding", () => {
    const result = resolveProjectKey("", null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("projectKey");
    }
  });

  it("returns error when explicit is empty string even with binding present", () => {
    // empty string is falsy — binding should fill it
    const result = resolveProjectKey("", binding);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.projectKey).toBe("KAN");
  });

  // ── error message is actionable ───────────────────────────────────────────

  it("error message mentions .kanon file and projectKey param for actionability", () => {
    const result = resolveProjectKey(undefined, null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Message must guide the user to either add .kanon or pass projectKey
      expect(result.error.toLowerCase()).toMatch(/\.kanon|projectkey/i);
    }
  });
});

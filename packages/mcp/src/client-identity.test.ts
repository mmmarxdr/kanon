// ─── MCP clientIdentity validation tests (S1 review fix / KAN-30) ──────────
//
// RED phase: these tests MUST fail before client-identity.ts is created.
// GREEN phase: pass after resolveClientIdentity is implemented.

import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveClientIdentity, VALID_IDENTITIES } from "./client-identity.js";

describe("resolveClientIdentity — MCP startup validation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a valid identity as-is", () => {
    const result = resolveClientIdentity("claude-code");
    expect(result).toBe("claude-code");
  });

  it("accepts Codex provenance", () => {
    expect(resolveClientIdentity("codex")).toBe("codex");
  });

  it("trims whitespace before validation", () => {
    const result = resolveClientIdentity("  cursor  ");
    expect(result).toBe("cursor");
  });

  it("lowercases before validation", () => {
    const result = resolveClientIdentity("Claude-Code");
    expect(result).toBe("claude-code");
  });

  it("returns null for an invalid identity and logs warning to stderr", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const result = resolveClientIdentity("my-unknown-bot");

    expect(result).toBeNull();
    expect(stderrSpy).toHaveBeenCalledOnce();
    const message = stderrSpy.mock.calls[0]![0] as string;
    expect(message).toContain("my-unknown-bot");
    expect(message).toContain("invalid");
  });

  it("returns null for undefined input without logging", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const result = resolveClientIdentity(undefined);

    expect(result).toBeNull();
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("returns null for empty string without logging", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const result = resolveClientIdentity("");

    expect(result).toBeNull();
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("accepts all valid identities", () => {
    for (const id of VALID_IDENTITIES) {
      expect(resolveClientIdentity(id)).toBe(id);
    }
  });
});

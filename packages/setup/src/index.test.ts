/**
 * G1 — Commander dispatcher routing tests.
 *
 * Tests that:
 *   1. argv[2]==="login"          → login() called
 *   2. argv[2] starts with kanon:// → onboardFromLink() called
 *   3. flags (--api-url / --api-key)  → cascade resolver called (not onboard/login)
 *   4. no argv[2]                 → cascade resolver called
 *
 * The dispatcher lives in `index.ts` but is extracted to a testable helper so
 * we can call it without triggering process.exit or Commander's parse().
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { dispatch } from "./index.js";

// ── Mock onboardFromLink ───────────────────────────────────────────────────────
vi.mock("./onboard.js", () => ({
  onboardFromLink: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock login ────────────────────────────────────────────────────────────────
vi.mock("./login.js", () => ({
  login: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock the cascade resolver (the existing run() function) ──────────────────
// We can't easily mock run() since it's in the same module, but dispatch will
// delegate to a deps-injected callback for the cascade path.

import { onboardFromLink } from "./onboard.js";
import { login } from "./login.js";

describe("Commander dispatcher — dispatch()", () => {
  let cascadeWasCalled: boolean;
  let cascadeDeps: { cascade: () => Promise<void> };

  beforeEach(() => {
    cascadeWasCalled = false;
    cascadeDeps = {
      cascade: async () => {
        cascadeWasCalled = true;
      },
    };
    vi.clearAllMocks();
  });

  it("routes 'login' arg to login()", async () => {
    await dispatch(["node", "index.js", "login"], {}, cascadeDeps);

    expect(login).toHaveBeenCalledOnce();
    expect(onboardFromLink).not.toHaveBeenCalled();
    expect(cascadeWasCalled).toBe(false);
  });

  it("routes kanon:// positional arg to onboardFromLink()", async () => {
    const link = "kanon://server.example.com/onboard?token=abc123.def456.ghi789";
    await dispatch(["node", "index.js", link], {}, cascadeDeps);

    expect(onboardFromLink).toHaveBeenCalledWith(link, expect.anything());
    expect(login).not.toHaveBeenCalled();
    expect(cascadeWasCalled).toBe(false);
  });

  it("routes --api-url / --api-key flags to cascade resolver", async () => {
    await dispatch(
      ["node", "index.js", "--api-url", "https://api.test", "--api-key", "sk-abc"],
      { apiUrl: "https://api.test", apiKey: "sk-abc" },
      cascadeDeps,
    );

    expect(cascadeWasCalled).toBe(true);
    expect(onboardFromLink).not.toHaveBeenCalled();
    expect(login).not.toHaveBeenCalled();
  });

  it("routes empty args to cascade resolver (default path)", async () => {
    await dispatch(["node", "index.js"], {}, cascadeDeps);

    expect(cascadeWasCalled).toBe(true);
    expect(onboardFromLink).not.toHaveBeenCalled();
    expect(login).not.toHaveBeenCalled();
  });
});

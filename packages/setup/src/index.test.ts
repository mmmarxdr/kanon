/**
 * G1 — Commander dispatcher routing tests.
 *
 * Tests that:
 *   1. argv[2]==="login"                     → login() called
 *   2. argv[2] starts with kanon://           → deprecation error (non-zero exit, not onboard)
 *   3. KANON_ONBOARD_LINK env set             → onboardFromLink(env-value) called
 *   4. piped stdin starts with kanon://       → onboardFromLink(stdin-line) called
 *   5. flags (--api-url / --api-key)          → cascade resolver called (not onboard/login)
 *   6. no argv[2]                             → cascade resolver called
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

  // ── Login route ─────────────────────────────────────────────────────────────
  it("routes 'login' arg to login()", async () => {
    await dispatch(
      ["node", "index.js", "login"],
      {},
      cascadeDeps,
      { env: {}, isTTY: true, readStdin: async () => null },
    );

    expect(login).toHaveBeenCalledOnce();
    expect(onboardFromLink).not.toHaveBeenCalled();
    expect(cascadeWasCalled).toBe(false);
  });

  // ── Deprecation on argv kanon:// ────────────────────────────────────────────
  it("emits deprecation error when kanon:// is passed as argv (old contract)", async () => {
    const link = "kanon://server.example.com/onboard?token=abc123.def456.ghi789";

    await expect(
      dispatch(
        ["node", "index.js", link],
        {},
        cascadeDeps,
        { env: {}, isTTY: true, readStdin: async () => null },
      ),
    ).rejects.toThrow(/deprecated/i);

    expect(onboardFromLink).not.toHaveBeenCalled();
    expect(cascadeWasCalled).toBe(false);
  });

  // ── Env link reader ─────────────────────────────────────────────────────────
  it("reads kanon:// link from KANON_ONBOARD_LINK env and calls onboardFromLink", async () => {
    const link = "kanon://server.example.com/onboard?token=env123.def456.ghi789";

    await dispatch(
      ["node", "index.js"],
      {},
      cascadeDeps,
      { env: { KANON_ONBOARD_LINK: link }, isTTY: true, readStdin: async () => null },
    );

    expect(onboardFromLink).toHaveBeenCalledWith(link, expect.anything());
    expect(login).not.toHaveBeenCalled();
    expect(cascadeWasCalled).toBe(false);
  });

  // ── Stdin link reader ───────────────────────────────────────────────────────
  it("reads kanon:// link from piped stdin (isTTY=false) and calls onboardFromLink", async () => {
    const link = "kanon://server.example.com/onboard?token=stdin123.def456.ghi789";

    await dispatch(
      ["node", "index.js"],
      {},
      cascadeDeps,
      { env: {}, isTTY: false, readStdin: async () => link },
    );

    expect(onboardFromLink).toHaveBeenCalledWith(link, expect.anything());
    expect(login).not.toHaveBeenCalled();
    expect(cascadeWasCalled).toBe(false);
  });

  it("falls through to cascade when piped stdin does NOT start with kanon://", async () => {
    await dispatch(
      ["node", "index.js"],
      {},
      cascadeDeps,
      { env: {}, isTTY: false, readStdin: async () => "some random data" },
    );

    expect(cascadeWasCalled).toBe(true);
    expect(onboardFromLink).not.toHaveBeenCalled();
  });

  it("does NOT read stdin when stdin is a TTY (would block)", async () => {
    const readStdin = vi.fn(async () => null);

    await dispatch(
      ["node", "index.js"],
      {},
      cascadeDeps,
      { env: {}, isTTY: true, readStdin },
    );

    expect(readStdin).not.toHaveBeenCalled();
    expect(cascadeWasCalled).toBe(true);
  });

  // ── Env takes priority over stdin ───────────────────────────────────────────
  it("prefers KANON_ONBOARD_LINK env over piped stdin", async () => {
    const envLink = "kanon://env-host/onboard?token=env.aaa.bbb";
    const stdinLink = "kanon://stdin-host/onboard?token=stdin.ccc.ddd";

    await dispatch(
      ["node", "index.js"],
      {},
      cascadeDeps,
      { env: { KANON_ONBOARD_LINK: envLink }, isTTY: false, readStdin: async () => stdinLink },
    );

    expect(onboardFromLink).toHaveBeenCalledWith(envLink, expect.anything());
    expect(onboardFromLink).toHaveBeenCalledTimes(1);
  });

  // ── Cascade routes ──────────────────────────────────────────────────────────
  it("routes --api-url / --api-key flags to cascade resolver", async () => {
    await dispatch(
      ["node", "index.js", "--api-url", "https://api.test", "--api-key", "sk-abc"],
      { apiUrl: "https://api.test", apiKey: "sk-abc" },
      cascadeDeps,
      { env: {}, isTTY: true, readStdin: async () => null },
    );

    expect(cascadeWasCalled).toBe(true);
    expect(onboardFromLink).not.toHaveBeenCalled();
    expect(login).not.toHaveBeenCalled();
  });

  it("routes empty args to cascade resolver (default path)", async () => {
    await dispatch(
      ["node", "index.js"],
      {},
      cascadeDeps,
      { env: {}, isTTY: true, readStdin: async () => null },
    );

    expect(cascadeWasCalled).toBe(true);
    expect(onboardFromLink).not.toHaveBeenCalled();
    expect(login).not.toHaveBeenCalled();
  });
});

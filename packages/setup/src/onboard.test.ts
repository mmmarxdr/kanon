/**
 * G2 — onboardFromLink() unit tests.
 *
 * All external calls are injected via deps so no real HTTP / FS happens.
 *
 * Scenarios:
 *   S2.1 happy path  → store.writeCredentials() + writeMcpEntries() called
 *   S2.3 invalid URL → process.exit(1) + stderr "Invalid onboarding link format"
 *   S2.4 expired token (400 TOKEN_EXPIRED)  → process.exit(1) + stderr msg
 *   S2.5 consumed token (400 TOKEN_CONSUMED) → process.exit(1) + stderr msg
 *   S2.6 network failure (fetch throws)     → process.exit(1) + stderr msg
 *   S2.7 store.writeCredentials throws       → process.exit(1) + stderr msg
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { onboardFromLink } from "./onboard.js";
import type { CredentialStore, Creds } from "./credential-store/index.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

const VALID_LINK =
  "kanon://server.example.com/onboard?token=abc123.def456.ghi789jwt";

const ONBOARD_RESPONSE = {
  refreshToken: "opaque-refresh-token-abc",
  apiUrl: "https://server.example.com",
  workspace: { id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", slug: "acme", name: "Acme" },
  email: "dev@example.com",
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
};

function makeFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response);
}

function makeStore(): CredentialStore {
  return {
    readCredentials: vi.fn().mockResolvedValue(null),
    writeCredentials: vi.fn().mockResolvedValue(undefined),
    clearCredentials: vi.fn().mockResolvedValue(undefined),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("onboardFromLink()", () => {
  let writeMcpEntries: ReturnType<typeof vi.fn>;
  let stdoutSink: { write: ReturnType<typeof vi.fn> };
  let store: CredentialStore;

  beforeEach(() => {
    writeMcpEntries = vi.fn().mockResolvedValue([
      {
        name: "claude-code",
        displayName: "Claude Code",
        configPath: "/home/test/.claude.json",
      },
    ]);
    stdoutSink = { write: vi.fn() };
    store = makeStore();
  });

  it("S2.1 happy path — writes credentials, registers MCP entry, prints progress", async () => {
    const fetchFn = makeFetch(200, ONBOARD_RESPONSE);

    await onboardFromLink(VALID_LINK, {
      fetchFn,
      credentialStore: store,
      writeMcpEntries,
      stdout: stdoutSink,
    });

    // POST to /api/auth/onboard with token
    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://server.example.com/api/auth/onboard");
    expect(JSON.parse(init.body as string)).toMatchObject({
      token: "abc123.def456.ghi789jwt",
    });

    // Credentials persisted under the canonical apiUrl key (matches the
    // wrapper's --server lookup format)
    expect(store.writeCredentials).toHaveBeenCalledWith(
      "https://server.example.com",
      expect.objectContaining<Partial<Creds>>({
        server: "https://server.example.com",
        refreshToken: ONBOARD_RESPONSE.refreshToken,
        email: ONBOARD_RESPONSE.email,
      }),
    );

    // MCP entries registered for detected tools — now receives (apiUrl, workspaceId)
    expect(writeMcpEntries).toHaveBeenCalledOnce();
    expect(writeMcpEntries).toHaveBeenCalledWith(
      "https://server.example.com",
      ONBOARD_RESPONSE.workspace.id,
    );

    // Progress messages surface identity, server, creds path, and tool list
    const stdoutOutput = stdoutSink.write.mock.calls.map((c) => c[0]).join("");
    expect(stdoutOutput).toMatch(/onboarded as dev@example\.com/i);
    expect(stdoutOutput).toMatch(/server: https:\/\/server\.example\.com/i);
    expect(stdoutOutput).toMatch(/credentials saved/i);
    expect(stdoutOutput).toMatch(/claude code/i);
    expect(stdoutOutput).toMatch(/restart your ai coding tool/i);
  });

  it("S2.1b prints a no-tools-detected hint when registry returns empty", async () => {
    const fetchFn = makeFetch(200, ONBOARD_RESPONSE);
    const emptyWrite = vi.fn().mockResolvedValue([]);

    await onboardFromLink(VALID_LINK, {
      fetchFn,
      credentialStore: store,
      writeMcpEntries: emptyWrite,
      stdout: stdoutSink,
    });

    const stdoutOutput = stdoutSink.write.mock.calls.map((c) => c[0]).join("");
    expect(stdoutOutput).toMatch(/onboarded as dev@example\.com/i);
    expect(stdoutOutput).toMatch(/no supported ai tools detected/i);
    expect(stdoutOutput).not.toMatch(/restart your ai coding tool/i);
  });

  it("S2.3 invalid URL format → exits 1", async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((_code?: number) => {
        throw new Error("process.exit");
      });

    await expect(
      onboardFromLink("https://not-a-kanon-link/bad", {}),
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    const stderrOutput = stderrSpy.mock.calls.map((c) => c[0]).join("");
    expect(stderrOutput).toMatch(/invalid onboarding link format/i);

    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("S2.4 expired token (400 TOKEN_EXPIRED) → exits 1", async () => {
    const fetchFn = makeFetch(400, {
      code: "TOKEN_EXPIRED",
      message: "Token has expired",
    });
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((_code?: number) => {
        throw new Error("process.exit");
      });

    await expect(
      onboardFromLink(VALID_LINK, { fetchFn, credentialStore: store, writeMcpEntries }),
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    const stderrOutput = stderrSpy.mock.calls.map((c) => c[0]).join("");
    expect(stderrOutput).toMatch(/expired/i);

    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("S2.5 consumed token (400 TOKEN_CONSUMED) → exits 1", async () => {
    const fetchFn = makeFetch(400, {
      code: "TOKEN_CONSUMED",
      message: "Token already used",
    });
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((_code?: number) => {
        throw new Error("process.exit");
      });

    await expect(
      onboardFromLink(VALID_LINK, { fetchFn, credentialStore: store, writeMcpEntries }),
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    const stderrOutput = stderrSpy.mock.calls.map((c) => c[0]).join("");
    expect(stderrOutput).toMatch(/already|consumed/i);

    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("S2.6 network failure → exits 1", async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValue(new TypeError("fetch failed"));
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((_code?: number) => {
        throw new Error("process.exit");
      });

    await expect(
      onboardFromLink(VALID_LINK, { fetchFn, credentialStore: store, writeMcpEntries }),
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    const stderrOutput = stderrSpy.mock.calls.map((c) => c[0]).join("");
    expect(stderrOutput).toMatch(/network|failed|unreachable/i);

    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("S2.7 store.writeCredentials throws → exits 1", async () => {
    const fetchFn = makeFetch(200, ONBOARD_RESPONSE);
    const badStore: CredentialStore = {
      ...makeStore(),
      writeCredentials: vi
        .fn()
        .mockRejectedValue(new Error("EACCES: permission denied")),
    };
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((_code?: number) => {
        throw new Error("process.exit");
      });

    await expect(
      onboardFromLink(VALID_LINK, {
        fetchFn,
        credentialStore: badStore,
        writeMcpEntries,
      }),
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    const stderrOutput = stderrSpy.mock.calls.map((c) => c[0]).join("");
    expect(stderrOutput).toMatch(/credential|save|write/i);

    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

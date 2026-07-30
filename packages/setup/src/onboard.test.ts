/**
 * G2 — onboardFromLink() unit tests.
 *
 * All external calls are injected via deps so no real HTTP / FS happens.
 *
 * Scenarios:
 *   S2.1 happy path  → credentials + full tool surface installer
 *   S2.3 invalid URL → process.exit(1) + stderr "Invalid onboarding link format"
 *   S2.4 expired token (400 TOKEN_EXPIRED)  → process.exit(1) + stderr msg
 *   S2.5 consumed token (400 TOKEN_CONSUMED) → process.exit(1) + stderr msg
 *   S2.6 network failure (fetch throws)     → process.exit(1) + stderr msg
 *   S2.7 store.writeCredentials throws       → process.exit(1) + stderr msg
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "smol-toml";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { installOnboardedTools, onboardFromLink } from "./onboard.js";
import type { CredentialStore, Creds } from "./credential-store/index.js";
import { getToolByName } from "./registry.js";

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
    listServers: vi.fn().mockResolvedValue([]),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("onboardFromLink()", () => {
  let installToolSurfaces: ReturnType<typeof vi.fn>;
  let stdoutSink: { write: ReturnType<typeof vi.fn> };
  let store: CredentialStore;

  beforeEach(() => {
    installToolSurfaces = vi.fn().mockResolvedValue([
      {
        name: "claude-code",
        displayName: "Claude Code",
        configPaths: ["/home/test/.claude.json"],
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
      installToolSurfaces,
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
    expect(installToolSurfaces).toHaveBeenCalledOnce();
    expect(installToolSurfaces).toHaveBeenCalledWith(
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
      installToolSurfaces: emptyWrite,
      stdout: stdoutSink,
    });

    const stdoutOutput = stdoutSink.write.mock.calls.map((c) => c[0]).join("");
    expect(stdoutOutput).toMatch(/onboarded as dev@example\.com/i);
    expect(stdoutOutput).toMatch(/no supported ai tools detected/i);
    expect(stdoutOutput).not.toMatch(/restart your ai coding tool/i);
  });

  it("fails onboarding when full-surface installation fails", async () => {
    const installError = new Error("Invalid JSON in ~/.cursor/mcp.json");

    await expect(onboardFromLink(VALID_LINK, {
      fetchFn: makeFetch(200, ONBOARD_RESPONSE),
      credentialStore: store,
      installToolSurfaces: vi.fn().mockRejectedValue(installError),
      stdout: stdoutSink,
    })).rejects.toBe(installError);

    expect(stdoutSink.write.mock.calls.map((call) => call[0]).join(""))
      .toMatch(/Failed to configure AI tools.*Invalid JSON/s);
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
      onboardFromLink(VALID_LINK, { fetchFn, credentialStore: store, installToolSurfaces }),
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
      onboardFromLink(VALID_LINK, { fetchFn, credentialStore: store, installToolSurfaces }),
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
      onboardFromLink(VALID_LINK, { fetchFn, credentialStore: store, installToolSurfaces }),
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
        installToolSurfaces,
      }),
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    const stderrOutput = stderrSpy.mock.calls.map((c) => c[0]).join("");
    expect(stderrOutput).toMatch(/credential|save|write/i);

    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("production onboarding installer writes MCP, skills, agent, and TOML surfaces", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "kanon-onboard-surface-"));
    const assetsDir = path.join(home, "assets");
    try {
      for (const skill of ["kanon-agent", "kanon-init", "kanon-onboard"]) {
        const dir = path.join(assetsDir, "skills", skill);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "SKILL.md"), `# ${skill}\n`);
      }
      fs.mkdirSync(path.join(assetsDir, "agents"), { recursive: true });
      fs.writeFileSync(
        path.join(assetsDir, "agents", "kanon.md"),
        "---\nname: kanon\ndescription: Board agent\nallowed-tools:\n  - kanon_*\n---\n\nBody\n",
      );

      const tools = [getToolByName("cursor")!, getToolByName("codex")!];
      const installed = await installOnboardedTools(
        "https://server.example.com/",
        "workspace-1",
        {
          ctx: { platform: "linux", homedir: home },
          tools,
          assetsDir,
          nodeBin: "/usr/bin/node",
          wrapperResolution: { mode: "local", path: "/release/mcp/dist/wrapper-cli.js" },
        },
      );

      expect(installed.map((tool) => tool.name)).toEqual(["cursor", "codex"]);
      const cursorConfig = JSON.parse(
        fs.readFileSync(path.join(home, ".cursor", "mcp.json"), "utf8"),
      );
      expect(cursorConfig.mcpServers["kanon"]).toMatchObject({
        type: "stdio",
        command: "/usr/bin/node",
        args: [
          "/release/mcp/dist/wrapper-cli.js",
          "--server",
          "https://server.example.com",
        ],
        env: {
          KANON_CLIENT_IDENTITY: "cursor",
          KANON_WORKSPACE_ID: "workspace-1",
        },
      });
      expect(fs.existsSync(path.join(home, ".cursor", "skills", "kanon-agent", "SKILL.md"))).toBe(true);
      expect(fs.readFileSync(path.join(home, ".cursor", "agents", "kanon.md"), "utf8"))
        .not.toContain("allowed-tools");

      const codex = parse(fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8")) as Record<string, unknown>;
      expect((codex["mcp_servers"] as Record<string, unknown>)["kanon"]).toBeDefined();
      expect(fs.existsSync(path.join(home, ".codex", "skills", "kanon-onboard", "SKILL.md"))).toBe(true);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("isolates an invalid selected tool after configuring the others", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "kanon-onboard-isolation-"));
    const assetsDir = path.join(home, "assets");
    try {
      fs.mkdirSync(path.join(assetsDir, "skills"), { recursive: true });
      fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
      fs.writeFileSync(path.join(home, ".codex", "config.toml"), "not = valid = toml");

      const installed = await installOnboardedTools(
        "https://server.example.com",
        "workspace-1",
        {
          ctx: { platform: "linux", homedir: home },
          tools: [getToolByName("cursor")!, getToolByName("codex")!],
          assetsDir,
          nodeBin: "/usr/bin/node",
          wrapperResolution: { mode: "local", path: "/release/mcp/dist/wrapper-cli.js" },
        },
      );

      expect(installed[0]?.name).toBe("cursor");
      expect(installed[0]?.error).toBeUndefined();
      expect(installed[1]).toMatchObject({ name: "codex", error: expect.stringMatching(/Invalid TOML/) });
      expect(fs.existsSync(path.join(home, ".cursor", "mcp.json"))).toBe(true);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

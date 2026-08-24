import fs from "node:fs";
import os from "node:os";
import path from "node:path";
/**
 * mcp-config.test.ts — characterization tests for buildWrapperMcpEntry
 * + key-parity proof: setup write-key === mcp read-key (byte-identical).
 *
 * KAN-35: The credential-store key used when writing (setup/onboard) and
 * reading (mcp/wrapper) MUST be byte-identical when both apply canonicalization.
 * Any drift here causes the wrapper to fail silently (no credentials found).
 */
import { describe, it, expect } from "vitest";
import { canonicalizeApiUrl } from "./canonical-url.js";
import { buildMcpEntry, buildWrapperMcpEntry, removeToolMcpConfig } from "./mcp-config.js";
import { getToolByName } from "./registry.js";
import { removeToolMcpSurface } from "./tool-surface.js";

describe("canonicalizeApiUrl parity: setup write-key === mcp read-key", () => {
  /**
   * These cases represent real-world scenarios where the same server may be
   * specified with different surface forms. Both sides MUST produce the same key.
   */
  const parityMatrix: Array<[string, string, string]> = [
    [
      "trailing-slash variant produces same key",
      "https://server.example.com",
      "https://server.example.com/",
    ],
    [
      "explicit :443 produces same key as no-port",
      "https://server.example.com",
      "https://server.example.com:443",
    ],
    [
      "mixed case host produces same key",
      "https://server.example.com",
      "https://SERVER.EXAMPLE.COM",
    ],
    [
      "path suffix stripped — same key as bare origin",
      "https://server.example.com",
      "https://server.example.com/api/v1",
    ],
  ];

  for (const [label, canonForm, driftForm] of parityMatrix) {
    it(label, () => {
      const setupWriteKey = canonicalizeApiUrl(canonForm);
      const mcpReadKey = canonicalizeApiUrl(driftForm);
      expect(mcpReadKey).toBe(setupWriteKey);
    });
  }

  it("both sides arrive at the same key byte-for-byte (localhost with port)", () => {
    // setup writes credentials keyed by canonicalize(data.apiUrl)
    const serverResponse = "http://localhost:3000/";
    const setupWriteKey = canonicalizeApiUrl(serverResponse);

    // mcp reads credentials by canonicalize(--server arg)
    const wrapperServerArg = "http://localhost:3000";
    const mcpReadKey = canonicalizeApiUrl(wrapperServerArg);

    expect(setupWriteKey).toBe("http://localhost:3000");
    expect(mcpReadKey).toBe("http://localhost:3000");
    expect(setupWriteKey).toBe(mcpReadKey);
  });
});

describe("buildWrapperMcpEntry includes canonicalized --server arg", () => {
  it("wrapper entry args contain the canonical server url (no trailing slash)", () => {
    const entry = buildWrapperMcpEntry(
      "https://server.example.com/",
      "direct",
      "/usr/bin/node",
      { mode: "local", path: "/usr/local/bin/wrapper-cli.js" },
    );
    // The --server arg must be canonicalized so the wrapper's credential lookup
    // matches what setup wrote.
    const serverIdx = entry.args.indexOf("--server");
    expect(serverIdx).toBeGreaterThanOrEqual(0);
    const serverArg = entry.args[serverIdx + 1];
    expect(serverArg).toBe("https://server.example.com");
  });

  it("wrapper entry for wsl-bridge mode uses canonicalized --server arg", () => {
    const entry = buildWrapperMcpEntry(
      "https://server.example.com/",
      "wsl-bridge",
      "/usr/bin/node",
      { mode: "local", path: "/usr/local/bin/wrapper-cli.js" },
    );
    const serverIdx = entry.args.indexOf("--server");
    expect(serverIdx).toBeGreaterThanOrEqual(0);
    const serverArg = entry.args[serverIdx + 1];
    expect(serverArg).toBe("https://server.example.com");
  });

  it("wrapper entry carries Cursor identity and workspace through wsl env", () => {
    const entry = buildWrapperMcpEntry(
      "https://server.example.com/",
      "wsl-bridge",
      "/usr/bin/node",
      { mode: "local", path: "/release/mcp/dist/wrapper-cli.js" },
      "workspace-1",
      "cursor",
    );
    expect(entry.args).toEqual([
      "env",
      "KANON_CLIENT_IDENTITY=cursor",
      "KANON_WORKSPACE_ID=workspace-1",
      "/usr/bin/node",
      "/release/mcp/dist/wrapper-cli.js",
      "--server",
      "https://server.example.com",
    ]);
  });
});


it("pins the validated WSL distro in a Windows Cursor wrapper entry", () => {
  const entry = buildWrapperMcpEntry("https://server.example.com", "wsl-bridge", "/usr/bin/node", { mode: "local", path: "/wrapper.js" }, undefined, "cursor", "Ubuntu-24.04");
  expect(entry.command).toBe("wsl");
  expect(entry.args.slice(0, 5)).toEqual(["--distribution", "Ubuntu-24.04", "--", "env", "KANON_CLIENT_IDENTITY=cursor"]);
});

it("uses the validated WSL Node path in the pinned bridge wrapper argv", () => {
  const entry = buildWrapperMcpEntry("https://server.example.com", "wsl-bridge", "/usr/bin/node", { mode: "local", path: "/wrapper.js" }, undefined, "cursor", "Ubuntu", "/home/me/.nvm/versions/node/v24/bin/node");
  expect(entry.args).toContain("/home/me/.nvm/versions/node/v24/bin/node");
  expect(entry.args).not.toContain("/usr/bin/node");
});

it("uses the validated WSL Node path for static-key bridge entries too", () => {
  const entry = buildMcpEntry({ mode: "local", path: "/mcp.js" }, "https://server.example.com", "key", { platform: "wsl", homedir: "/home/me", winHome: "/mnt/c/Users/me" }, "wsl-bridge", "/usr/bin/node", "static-key", "cursor", undefined, "Ubuntu", "/home/me/.nvm/versions/node/v24/bin/node");
  expect(entry.args).toContain("/home/me/.nvm/versions/node/v24/bin/node");
  expect(entry.args).not.toContain("/usr/bin/node");
});


describe("removal failures preserve malformed config bytes", () => {
  it("throws for malformed JSON instead of treating it as missing", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kanon-remove-malformed-"));
    try {
      const file = path.join(root, "mcp.json");
      const raw = "{ malformed";
      fs.writeFileSync(file, raw);
      expect(() => removeToolMcpConfig(file, { rootKey: "mcpServers" })).toThrow(/Invalid JSON/);
      expect(fs.readFileSync(file, "utf8")).toBe(raw);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("throws for malformed TOML without rewriting the file", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kanon-remove-malformed-"));
    try {
      const file = path.join(root, "config.toml");
      const raw = "[mcp_servers.kanon\ncommand = \"node\"\n";
      fs.writeFileSync(file, raw);
      expect(() => removeToolMcpConfig(file, {
        rootKey: "mcp_servers", configFormat: "toml",
      })).toThrow(/Invalid TOML/);
      expect(fs.readFileSync(file, "utf8")).toBe(raw);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});


describe("surface removal preflight", () => {
  const cursor = getToolByName("cursor")!;

  it("does not remove a valid local Cursor entry before a malformed Windows target fails", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kanon-remove-preflight-"));
    try {
      const ctx = { platform: "wsl" as const, homedir: path.join(root, "linux"), winHome: path.join(root, "windows") };
      const local = path.join(ctx.homedir, ".cursor", "mcp.json");
      const windows = path.join(ctx.winHome, ".cursor", "mcp.json");
      const localRaw = '{"mcpServers":{"kanon":{"command":"node"}}}';
      const windowsRaw = "{ malformed";
      fs.mkdirSync(path.dirname(local), { recursive: true });
      fs.mkdirSync(path.dirname(windows), { recursive: true });
      fs.writeFileSync(local, localRaw); fs.writeFileSync(windows, windowsRaw);

      expect(() => removeToolMcpSurface(cursor, ctx)).toThrow(/Invalid JSON/);
      expect(fs.readFileSync(local, "utf8")).toBe(localRaw);
      expect(fs.readFileSync(windows, "utf8")).toBe(windowsRaw);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it("does not remove a valid local Cursor entry before a top-level null Windows target fails", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kanon-remove-preflight-"));
    try {
      const ctx = { platform: "wsl" as const, homedir: path.join(root, "linux"), winHome: path.join(root, "windows") };
      const local = path.join(ctx.homedir, ".cursor", "mcp.json");
      const windows = path.join(ctx.winHome, ".cursor", "mcp.json");
      const localRaw = '{"mcpServers":{"kanon":{"command":"node"}}}';
      const windowsRaw = "null";
      fs.mkdirSync(path.dirname(local), { recursive: true });
      fs.mkdirSync(path.dirname(windows), { recursive: true });
      fs.writeFileSync(local, localRaw); fs.writeFileSync(windows, windowsRaw);

      expect(() => removeToolMcpSurface(cursor, ctx)).toThrow();
      expect(fs.readFileSync(local, "utf8")).toBe(localRaw);
      expect(fs.readFileSync(windows, "utf8")).toBe(windowsRaw);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it("does not remove a valid current Cursor entry before malformed legacy config fails", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kanon-remove-preflight-"));
    try {
      const ctx = { platform: "win32" as const, homedir: path.join(root, "home"), appDataDir: path.join(root, "appdata") };
      const current = path.join(ctx.homedir, ".cursor", "mcp.json");
      const legacy = path.join(ctx.appDataDir, "Cursor", "User", "mcp.json");
      const currentRaw = '{"mcpServers":{"kanon":{"command":"node"}}}';
      const legacyRaw = "{ malformed";
      fs.mkdirSync(path.dirname(current), { recursive: true });
      fs.mkdirSync(path.dirname(legacy), { recursive: true });
      fs.writeFileSync(current, currentRaw); fs.writeFileSync(legacy, legacyRaw);

      expect(() => removeToolMcpSurface(cursor, ctx)).toThrow(/Invalid JSON/);
      expect(fs.readFileSync(current, "utf8")).toBe(currentRaw);
      expect(fs.readFileSync(legacy, "utf8")).toBe(legacyRaw);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});

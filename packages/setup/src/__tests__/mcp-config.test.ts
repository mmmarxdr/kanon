import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "smol-toml";
import {
  mergeConfig,
  removeConfig,
  mergeTomlMcpConfig,
  removeTomlMcpConfig,
  formatCodexMcpEntry,
  buildMcpEntry,
  extractExistingAuth,
  extractExistingWorkspaceId,
  extractAuthFromEntry,
  formatMcpEntry,
  installToolMcpConfig,
  removeToolMcpConfig,
  resolveWrapperPath,
  MCP_NOT_FOUND_MESSAGE,
} from "../mcp-config.js";
import type { McpServerEntry, PlatformContext } from "../types.js";

describe("mcp-config", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kanon-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("mergeConfig", () => {
    it("should merge kanon entry into empty/new config file", () => {
      const configPath = path.join(tmpDir, "mcp.json");
      const entry = { command: "node", args: ["server.js"], env: { KANON_API_URL: "http://localhost" } };

      mergeConfig(configPath, "mcpServers", entry);

      const result = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(result.mcpServers["kanon"]).toEqual(entry);
    });

    it("should merge into config with existing MCP servers without clobbering them", () => {
      const configPath = path.join(tmpDir, "mcp.json");
      const existing = {
        mcpServers: {
          "other-server": { command: "other", args: [] },
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(existing));

      const entry = { command: "node", args: ["server.js"] };
      mergeConfig(configPath, "mcpServers", entry);

      const result = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(result.mcpServers["other-server"]).toEqual({ command: "other", args: [] });
      expect(result.mcpServers["kanon"]).toEqual(entry);
    });

    it("migrates the legacy kanon-mcp key without leaving a duplicate", () => {
      const configPath = path.join(tmpDir, "mcp.json");
      fs.writeFileSync(configPath, JSON.stringify({
        mcpServers: {
          other: { command: "other", args: [] },
          "kanon-mcp": { command: "old", args: [] },
        },
      }));

      const entry = { command: "node", args: ["server.js"] };
      mergeConfig(configPath, "mcpServers", entry);

      const servers = JSON.parse(fs.readFileSync(configPath, "utf8")).mcpServers;
      expect(servers.other).toBeDefined();
      expect(servers["kanon-mcp"]).toBeUndefined();
      expect(servers.kanon).toEqual(entry);
    });

    it("should be idempotent — running twice produces same result", () => {
      const configPath = path.join(tmpDir, "mcp.json");
      const entry = { command: "node", args: ["server.js"] };

      mergeConfig(configPath, "mcpServers", entry);
      const first = fs.readFileSync(configPath, "utf8");

      mergeConfig(configPath, "mcpServers", entry);
      const second = fs.readFileSync(configPath, "utf8");

      expect(first).toBe(second);
    });

    it("should create parent directories if they don't exist", () => {
      const configPath = path.join(tmpDir, "nested", "deep", "mcp.json");
      const entry = { command: "node", args: [] };

      mergeConfig(configPath, "mcpServers", entry);

      expect(fs.existsSync(configPath)).toBe(true);
      const result = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(result.mcpServers["kanon"]).toEqual(entry);
    });

    // ── PR2 — Task 2.1 RED: opencode "mcp" rootKey writes array-form command ──
    it("should write opencode 'mcp' rootKey entries in array-form (type: 'local', command: string[], environment)", () => {
      const configPath = path.join(tmpDir, "opencode.json");
      const entry: McpServerEntry = {
        command: "node",
        args: ["/path/with spaces/wrapper.js", "kanon"],
        env: { KANON_API_URL: "http://localhost:4001" },
      };

      mergeConfig(configPath, "mcp", entry);

      const result = JSON.parse(fs.readFileSync(configPath, "utf8"));
      // OpenCode array form: type discriminator + argv array + environment.
      expect(result.mcp["kanon"]).toEqual({
        type: "local",
        command: ["node", "/path/with spaces/wrapper.js", "kanon"],
        environment: { KANON_API_URL: "http://localhost:4001" },
      });
    });

    it("should preserve mcpServers object-form when caller passes it (no rewriting)", () => {
      // Sanity: mergeConfig on mcpServers keeps the object form, not array.
      const configPath = path.join(tmpDir, "claude.json");
      const entry: McpServerEntry = { command: "node", args: ["/srv.js"] };

      mergeConfig(configPath, "mcpServers", entry);

      const result = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(result.mcpServers["kanon"]).toEqual({
        command: "node",
        args: ["/srv.js"],
      });
    });

    it("rejects malformed JSON without changing a byte", () => {
      const configPath = path.join(tmpDir, "mcp.json");
      const malformed = "{\r\n  this stays invalid\r\n";
      fs.writeFileSync(configPath, malformed);

      expect(() => mergeConfig(configPath, "mcpServers", {
        command: "node",
        args: ["server.js"],
      })).toThrow(/Invalid JSON/);
      expect(fs.readFileSync(configPath, "utf8")).toBe(malformed);
    });
  });

  describe("removeConfig", () => {
    it("should remove kanon entry and leave other servers intact", () => {
      const configPath = path.join(tmpDir, "mcp.json");
      const config = {
        mcpServers: {
          "other-server": { command: "other", args: [] },
          "kanon": { command: "node", args: ["server.js"] },
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(config));

      const removed = removeConfig(configPath, "mcpServers");

      expect(removed).toBe(true);
      const result = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(result.mcpServers["other-server"]).toEqual({ command: "other", args: [] });
      expect(result.mcpServers["kanon"]).toBeUndefined();
    });

    it("should return false when config file does not exist", () => {
      const configPath = path.join(tmpDir, "nonexistent.json");
      const removed = removeConfig(configPath, "mcpServers");
      expect(removed).toBe(false);
    });

    it("should return false when kanon entry is not present (no-op, no error)", () => {
      const configPath = path.join(tmpDir, "mcp.json");
      const config = {
        mcpServers: {
          "other-server": { command: "other", args: [] },
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(config));

      const removed = removeConfig(configPath, "mcpServers");
      expect(removed).toBe(false);
    });
  });

  describe("extractExistingAuth", () => {
    it("should extract auth from direct-mode config (env object)", () => {
      // Write a config file that looks like a direct-mode kanon entry
      const configPath = path.join(tmpDir, ".claude.json");
      const config = {
        mcpServers: {
          "kanon": {
            command: "node",
            args: ["/path/to/server.js"],
            env: {
              KANON_API_URL: "http://localhost:4001",
              KANON_API_KEY: "test-key-123",
            },
          },
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(config));

      // Create a ctx that points claude-code's config to our tmp file
      const ctx: PlatformContext = {
        platform: "linux",
        homedir: tmpDir,
      };

      // Mock the registry to point to our tmp config
      // extractExistingAuth uses toolRegistry internally, so we need
      // the config path to match. Claude Code on linux uses `${homedir}/.claude.json`
      const result = extractExistingAuth(ctx);

      // Should find the URL and key from the env object
      expect(result.apiUrl).toBe("http://localhost:4001");
      expect(result.apiKey).toBe("test-key-123");
    });

    it("should extract auth from WSL bridge-mode config (args array)", () => {
      // WSL bridge mode puts env vars in the args array as KEY=VALUE
      // Cursor on WSL uses `${winHome}/.cursor/mcp.json`
      const cursorDir = path.join(tmpDir, ".cursor");
      fs.mkdirSync(cursorDir, { recursive: true });
      const configPath = path.join(cursorDir, "mcp.json");
      const config = {
        mcpServers: {
          "kanon": {
            command: "wsl",
            args: [
              "env",
              "KANON_API_URL=http://localhost:4001",
              "KANON_API_KEY=bridge-key-456",
              "node",
              "/path/to/server.js",
            ],
          },
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(config));

      const ctx: PlatformContext = {
        platform: "wsl",
        homedir: "/home/user",
        winHome: tmpDir,
      };

      const result = extractExistingAuth(ctx);

      expect(result.apiUrl).toBe("http://localhost:4001");
      expect(result.apiKey).toBe("bridge-key-456");
    });

    it("should return empty object when no kanon entry exists", () => {
      // Write a config with other servers but no kanon
      const configPath = path.join(tmpDir, ".claude.json");
      const config = {
        mcpServers: {
          "other-server": { command: "other", args: [] },
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(config));

      const ctx: PlatformContext = {
        platform: "linux",
        homedir: tmpDir,
      };

      const result = extractExistingAuth(ctx);

      expect(result.apiUrl).toBeUndefined();
      expect(result.apiKey).toBeUndefined();
    });

    it("should handle missing config file gracefully", () => {
      const ctx: PlatformContext = {
        platform: "linux",
        homedir: path.join(tmpDir, "nonexistent"),
      };

      const result = extractExistingAuth(ctx);

      expect(result.apiUrl).toBeUndefined();
      expect(result.apiKey).toBeUndefined();
    });
  });

  describe("buildMcpEntry", () => {
    it("should build a direct entry for linux", () => {
      const ctx = { platform: "linux" as const, homedir: "/home/user" };
      const entry = buildMcpEntry(
        { mode: "local", path: "/path/to/server.js" },
        "http://api.test", "key123",
        ctx, "direct", "/usr/bin/node",
      );

      expect(entry.command).toBe("/usr/bin/node");
      expect(entry.args).toEqual(["/path/to/server.js"]);
      expect(entry.env).toEqual({ KANON_API_URL: "http://api.test", KANON_API_KEY: "key123" });
    });

    it("should build a wsl-bridge entry for cursor on WSL", () => {
      const ctx = { platform: "wsl" as const, homedir: "/home/user", winHome: "/mnt/c/Users/User" };
      const entry = buildMcpEntry(
        { mode: "local", path: "/path/to/server.js" },
        "http://api.test", "key123",
        ctx, "wsl-bridge", "/usr/bin/node",
      );

      expect(entry.command).toBe("wsl");
      expect(entry.args).toContain("env");
      expect(entry.args).toContain("KANON_API_URL=http://api.test");
      expect(entry.args).toContain("KANON_API_KEY=key123");
      expect(entry.args).toContain("/usr/bin/node");
      expect(entry.args).toContain("/path/to/server.js");
    });

    it("should build a direct entry for claude-code on WSL (no wsl-bridge)", () => {
      const ctx = { platform: "wsl" as const, homedir: "/home/user", winHome: "/mnt/c/Users/User" };
      const entry = buildMcpEntry(
        { mode: "local", path: "/path/to/server.js" },
        "http://api.test", "key123",
        ctx, "direct", "/usr/bin/node",
      );

      expect(entry.command).toBe("/usr/bin/node");
      expect(entry.args).toEqual(["/path/to/server.js"]);
      expect(entry.env).toEqual({ KANON_API_URL: "http://api.test", KANON_API_KEY: "key123" });
    });

    it("should build a direct entry for win32", () => {
      const ctx = { platform: "win32" as const, homedir: "C:\\Users\\User", appDataDir: "C:\\Users\\User\\AppData\\Roaming" };
      const entry = buildMcpEntry(
        { mode: "local", path: "C:\\path\\to\\server.js" },
        "http://api.test", "key123",
        ctx, "direct", "C:\\Program Files\\nodejs\\node.exe",
      );

      expect(entry.command).toBe("C:\\Program Files\\nodejs\\node.exe");
      expect(entry.args).toEqual(["C:\\path\\to\\server.js"]);
      expect(entry.env).toEqual({ KANON_API_URL: "http://api.test", KANON_API_KEY: "key123" });
    });

    it("should build a wsl-bridge entry with local MCP path", () => {
      const ctx = { platform: "wsl" as const, homedir: "/home/user", winHome: "/mnt/c/Users/User" };
      const entry = buildMcpEntry(
        { mode: "local", path: "/path/to/server.js" },
        "http://api.test", "key123",
        ctx, "wsl-bridge", "/usr/bin/node",
      );

      expect(entry.command).toBe("wsl");
      expect(entry.args).toEqual([
        "env",
        "KANON_API_URL=http://api.test",
        "KANON_API_KEY=key123",
        "/usr/bin/node",
        "/path/to/server.js",
      ]);
    });

    it("propagates Cursor identity and workspace through direct wrapper mode", () => {
      const entry = buildMcpEntry(
        { mode: "local", path: "/release/wrapper-cli.js" },
        "https://api.test",
        "",
        { platform: "linux", homedir: "/home/user" },
        "direct",
        "/usr/bin/node",
        "wrapper",
        "cursor",
        "workspace-1",
      );
      expect(entry.env).toEqual({
        KANON_CLIENT_IDENTITY: "cursor",
        KANON_WORKSPACE_ID: "workspace-1",
      });
    });

    it("propagates Cursor identity and workspace through wsl env", () => {
      const entry = buildMcpEntry(
        { mode: "local", path: "/release/wrapper-cli.js" },
        "https://api.test",
        "",
        { platform: "wsl", homedir: "/home/user", winHome: "/mnt/c/Users/user" },
        "wsl-bridge",
        "/usr/bin/node",
        "wrapper",
        "cursor",
        "workspace-1",
      );
      expect(entry.args).toEqual([
        "env",
        "KANON_CLIENT_IDENTITY=cursor",
        "KANON_WORKSPACE_ID=workspace-1",
        "/usr/bin/node",
        "/release/wrapper-cli.js",
        "--server",
        "https://api.test",
      ]);
    });

    it("should omit KANON_API_KEY when empty in new signature", () => {
      const ctx = { platform: "linux" as const, homedir: "/home/user" };
      const entry = buildMcpEntry(
        { mode: "local", path: "/path/to/server.js" },
        "http://api.test", "",
        ctx, "direct", "/usr/bin/node",
      );

      expect(entry.env).toEqual({ KANON_API_URL: "http://api.test" });
      expect(entry.env!["KANON_API_KEY"]).toBeUndefined();
    });

    // G4 — wrapper-mode tests
    it("G4 wrapper mode — entry has no KANON_API_KEY, uses nodeBin + wrapperPath", () => {
      const ctx = { platform: "linux" as const, homedir: "/home/user" };
      const entry = buildMcpEntry(
        { mode: "local", path: "/path/to/server.js" },
        "https://server.example.com", "",
        ctx, "direct", "/usr/bin/node",
        "wrapper",
      );

      expect(entry.command).toBe("/usr/bin/node");
      expect(entry.args).toContain("/path/to/server.js");
      expect(entry.args).toContain("--server");
      expect(entry.args).toContain("https://server.example.com");
      // No KANON_API_KEY in env for wrapper mode
      expect(entry.env?.["KANON_API_KEY"]).toBeUndefined();
    });

    it("G4 static-key mode (default) — backward compat, KANON_API_KEY present", () => {
      const ctx = { platform: "linux" as const, homedir: "/home/user" };
      const entry = buildMcpEntry(
        { mode: "local", path: "/path/to/server.js" },
        "https://server.example.com", "sk-abc123",
        ctx, "direct", "/usr/bin/node",
        // no 7th arg = default "static-key"
      );

      expect(entry.env?.["KANON_API_KEY"]).toBe("sk-abc123");
      expect(entry.env?.["KANON_API_URL"]).toBe("https://server.example.com");
    });
  });

  // G4 — extractExistingAuth wrapper-mode detection
  describe("extractExistingAuth — wrapper mode", () => {
    it("detects wrapper-mode entry and returns apiUrl from --server arg", () => {
      const configPath = path.join(tmpDir, ".claude.json");
      const config = {
        mcpServers: {
          "kanon": {
            command: "/usr/bin/node",
            args: ["/opt/kanon/mcp-wrapper.js", "--server", "https://server.example.com"],
            // no env.KANON_API_KEY
          },
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(config));

      const ctx: PlatformContext = {
        platform: "linux",
        homedir: tmpDir,
      };

      const result = extractExistingAuth(ctx);

      expect(result.apiUrl).toBe("https://server.example.com");
      expect(result.apiKey).toBeUndefined();
    });

    // ── PR2 — Task 2.3: array-form command (OpenCode 'mcp' rootKey) ─────────
    // These are direct unit tests of the pure `extractAuthFromEntry` helper,
    // so they don't depend on the opencode tool being in the registry yet
    // (that lands in task 2.5). The integration paths above already cover
    // the cross-tool scan via `extractExistingAuth`.
    it("extracts apiUrl from array-form command (opencode 'mcp' rootKey, wrapper mode)", () => {
      const result = extractAuthFromEntry({
        command: ["/opt/node", "/srv/wrapper.js", "--server", "https://server.example.com"],
      });

      expect(result.apiUrl).toBe("https://server.example.com");
      expect(result.apiKey).toBeUndefined();
    });

    it("extracts KANON_API_URL and KANON_API_KEY from env on array-form command", () => {
      const result = extractAuthFromEntry({
        command: ["/opt/node", "/srv/wrapper.js"],
        env: {
          KANON_API_URL: "https://server.example.com",
          KANON_API_KEY: "sk-array-1",
        },
      });

      expect(result.apiUrl).toBe("https://server.example.com");
      expect(result.apiKey).toBe("sk-array-1");
    });

    it("extracts KANON_API_URL and KANON_API_KEY from `environment` (OpenCode on-disk name) on array-form command", () => {
      // OpenCode persists credentials under `environment` per its
      // `McpLocalConfig` schema. The legacy/internal `env` key MUST also
      // be accepted, with `environment` taking precedence when both are
      // present (so a stale legacy key cannot mask a fresh write).
      const result = extractAuthFromEntry({
        command: ["/opt/node", "/srv/wrapper.js"],
        environment: {
          KANON_API_URL: "https://server.example.com",
          KANON_API_KEY: "sk-env-key",
        },
      });

      expect(result.apiUrl).toBe("https://server.example.com");
      expect(result.apiKey).toBe("sk-env-key");
    });

    it("prefers `environment` over `env` when both are present (fresh-write wins)", () => {
      const result = extractAuthFromEntry({
        command: ["/opt/node", "/srv.js"],
        env: {
          KANON_API_URL: "https://legacy.example.com",
          KANON_API_KEY: "sk-legacy",
        },
        environment: {
          KANON_API_URL: "https://fresh.example.com",
          KANON_API_KEY: "sk-fresh",
        },
      });

      expect(result.apiUrl).toBe("https://fresh.example.com");
      expect(result.apiKey).toBe("sk-fresh");
    });

    it("extracts KANON_API_URL=... from a single argv element of an array-form command", () => {
      // WSL-bridge-style: KEY=VALUE appears as a single argv element.
      const result = extractAuthFromEntry({
        command: [
          "wsl",
          "env",
          "KANON_API_URL=http://localhost:4001",
          "KANON_API_KEY=sk-argv",
          "/opt/node",
          "/srv.js",
        ],
      });

      expect(result.apiUrl).toBe("http://localhost:4001");
      expect(result.apiKey).toBe("sk-argv");
    });

    it("preserves spaces in argv elements (no shell-escape required)", () => {
      // Wrapper path with spaces — array boundaries are the contract.
      const result = extractAuthFromEntry({
        command: [
          "/opt/with space/node",
          "/Users/me/Kanon Server/wrapper.js",
          "--server",
          "https://server.example.com",
        ],
      });

      expect(result.apiUrl).toBe("https://server.example.com");
    });

    it("returns empty object for empty entry", () => {
      const result = extractAuthFromEntry({});

      expect(result.apiUrl).toBeUndefined();
      expect(result.apiKey).toBeUndefined();
    });

    it("handles object-form (legacy) alongside array-form", () => {
      const result = extractAuthFromEntry({
        command: "/usr/bin/node",
        args: ["/srv.js", "--server", "https://legacy.example.com"],
      });

      expect(result.apiUrl).toBe("https://legacy.example.com");
    });
  });

  // ── PR2 — Task 2.1 RED: formatMcpEntry root-key formatter ─────────────────
  describe("formatMcpEntry", () => {
    it("returns OpenCode array-form { type: 'local'; command: string[]; environment? } when rootKey === 'mcp'", () => {
      const entry: McpServerEntry = {
        command: "node",
        args: ["/path/with spaces/wrapper.js", "kanon"],
        env: { KANON_API_URL: "http://localhost:4001" },
      };

      const result = formatMcpEntry("mcp", entry);

      expect(result).toEqual({
        type: "local",
        command: ["node", "/path/with spaces/wrapper.js", "kanon"],
        environment: { KANON_API_URL: "http://localhost:4001" },
      });
      // And not the object form
      expect((result as McpServerEntry).args).toBeUndefined();
      // And the legacy `env` key MUST NOT be emitted on the OpenCode form
      expect((result as { env?: unknown }).env).toBeUndefined();
    });

    it("preserves object-form { command, args, env? } when rootKey === 'mcpServers'", () => {
      const entry: McpServerEntry = {
        command: "node",
        args: ["/srv.js"],
        env: { KANON_API_KEY: "sk-abc" },
      };

      const result = formatMcpEntry("mcpServers", entry);

      expect(result).toEqual({
        command: "node",
        args: ["/srv.js"],
        env: { KANON_API_KEY: "sk-abc" },
      });
    });

    it("preserves spaces in argv elements (no shell-escape required — array boundaries are the contract)", () => {
      const entry: McpServerEntry = {
        command: "/opt/with space/bin/node",
        args: ["/Users/me/Applications/Kanon Server/wrapper.js"],
      };

      const result = formatMcpEntry("mcp", entry);

      // Each argv element stays a discrete string in the array — no splitting, no quoting.
      expect(result).toEqual({
        type: "local",
        command: [
          "/opt/with space/bin/node",
          "/Users/me/Applications/Kanon Server/wrapper.js",
        ],
      });
    });

    it("preserves env (renamed to environment) on OpenCode array-form output", () => {
      const entry: McpServerEntry = {
        command: "npx",
        args: ["@kanon/mcp@>=0.3.0"],
        env: { KANON_API_URL: "http://api", KANON_WORKSPACE_ID: "ws-1" },
      };

      const result = formatMcpEntry("mcp", entry);

      expect(result).toEqual({
        type: "local",
        command: ["npx", "@kanon/mcp@>=0.3.0"],
        environment: { KANON_API_URL: "http://api", KANON_WORKSPACE_ID: "ws-1" },
      });
    });

    it("omits environment when env is not present on array-form output", () => {
      const entry: McpServerEntry = {
        command: "node",
        args: ["/srv.js"],
      };

      const result = formatMcpEntry("mcp", entry);

      expect(result).toEqual({
        type: "local",
        command: ["node", "/srv.js"],
      });
      expect((result as { environment?: unknown }).environment).toBeUndefined();
    });
  });

  describe("mergeTomlMcpConfig", () => {
    it("upserts kanon into a missing config file", () => {
      const configPath = path.join(tmpDir, "config.toml");
      const entry = formatCodexMcpEntry({
        command: "node",
        args: ["/wrapper.js", "--server", "https://api.test"],
      });

      mergeTomlMcpConfig(configPath, "kanon", entry);

      const result = parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
      const servers = result["mcp_servers"] as Record<string, unknown>;
      expect(servers["kanon"]).toEqual({
        command: "node",
        args: ["/wrapper.js", "--server", "https://api.test"],
      });
    });

    it("preserves other mcp_servers entries", () => {
      const configPath = path.join(tmpDir, "config.toml");
      fs.writeFileSync(
        configPath,
        `
[mcp_servers.other]
command = "other"
args = ["run"]
`,
      );

      mergeTomlMcpConfig(
        configPath,
        "kanon",
        formatCodexMcpEntry({ command: "node", args: ["/srv.js"] }),
      );

      const result = parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
      const servers = result["mcp_servers"] as Record<string, unknown>;
      expect(servers["other"]).toEqual({ command: "other", args: ["run"] });
      expect(servers["kanon"]).toEqual({ command: "node", args: ["/srv.js"] });
    });

    it("writes env vars under mcp_servers.kanon.env subtable", () => {
      const configPath = path.join(tmpDir, "config.toml");
      mergeTomlMcpConfig(
        configPath,
        "kanon",
        formatCodexMcpEntry({
          command: "node",
          args: ["/srv.js"],
          env: {
            KANON_API_URL: "http://localhost:4001",
            KANON_API_KEY: "sk-test",
          },
        }),
      );

      const result = parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
      const entry = (result["mcp_servers"] as Record<string, unknown>)["kanon"] as {
        env?: Record<string, string>;
      };
      expect(entry.env).toEqual({
        KANON_API_URL: "http://localhost:4001",
        KANON_API_KEY: "sk-test",
      });
    });

    it("deletes the legacy kanon-mcp key during merge", () => {
      const configPath = path.join(tmpDir, "config.toml");
      fs.writeFileSync(
        configPath,
        `
[mcp_servers.kanon-mcp]
command = "legacy"
args = ["old"]
`,
      );

      mergeTomlMcpConfig(
        configPath,
        "kanon",
        formatCodexMcpEntry({ command: "node", args: ["/srv.js"] }),
      );

      const result = parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
      const servers = result["mcp_servers"] as Record<string, unknown>;
      expect(servers["kanon-mcp"]).toBeUndefined();
      expect(servers["kanon"]).toBeDefined();
    });

    it("is idempotent — running twice produces the same file", () => {
      const configPath = path.join(tmpDir, "config.toml");
      const entry = formatCodexMcpEntry({ command: "node", args: ["/srv.js"] });

      mergeTomlMcpConfig(configPath, "kanon", entry);
      const first = fs.readFileSync(configPath, "utf8");

      mergeTomlMcpConfig(configPath, "kanon", entry);
      const second = fs.readFileSync(configPath, "utf8");

      expect(first).toBe(second);
    });

    it("backs up and migrates a legacy JSON Codex config before reinstalling", () => {
      const configPath = path.join(tmpDir, "config.toml");
      const legacy = {
        model: "gpt-5",
        mcp_servers: {
          "kanon-mcp": { command: "old-node", args: ["old-wrapper.js"] },
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(legacy, null, 2));

      mergeTomlMcpConfig(
        configPath,
        "kanon",
        formatCodexMcpEntry({ command: "node", args: ["/new-wrapper.js"] }),
      );

      expect(JSON.parse(fs.readFileSync(`${configPath}.kanon-legacy-json.bak`, "utf8")))
        .toEqual(legacy);
      const migrated = parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
      expect(migrated["model"]).toBe("gpt-5");
      expect((migrated["mcp_servers"] as Record<string, unknown>)["kanon-mcp"])
        .toBeUndefined();
      expect((migrated["mcp_servers"] as Record<string, unknown>)["kanon"])
        .toEqual({ command: "node", args: ["/new-wrapper.js"] });
    });

    it("does not overwrite an unrecognized invalid Codex config", () => {
      const configPath = path.join(tmpDir, "config.toml");
      fs.writeFileSync(configPath, "not = valid = toml");

      expect(() => mergeTomlMcpConfig(
        configPath,
        "kanon",
        formatCodexMcpEntry({ command: "node", args: ["/wrapper.js"] }),
      )).toThrow(/Invalid TOML/);
      expect(fs.readFileSync(configPath, "utf8")).toBe("not = valid = toml");
      expect(fs.existsSync(`${configPath}.kanon-legacy-json.bak`)).toBe(false);
    });
  });

  describe("removeTomlMcpConfig", () => {
    it("removes kanon table and env subtable", () => {
      const configPath = path.join(tmpDir, "config.toml");
      fs.writeFileSync(
        configPath,
        `
[mcp_servers.kanon]
command = "node"
args = ["/srv.js"]

[mcp_servers.kanon.env]
KANON_WORKSPACE_ID = "ws-1"
`,
      );

      const removed = removeTomlMcpConfig(configPath, "kanon");
      expect(removed).toBe(true);

      const result = parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
      const servers = result["mcp_servers"] as Record<string, unknown> | undefined;
      expect(servers?.["kanon"]).toBeUndefined();
    });

    it("preserves unrelated mcp_servers entries", () => {
      const configPath = path.join(tmpDir, "config.toml");
      fs.writeFileSync(
        configPath,
        `
[mcp_servers.other]
command = "other"
args = ["run"]

[mcp_servers.kanon]
command = "node"
args = ["/srv.js"]
`,
      );

      removeTomlMcpConfig(configPath, "kanon");

      const result = parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
      const servers = result["mcp_servers"] as Record<string, unknown>;
      expect(servers["other"]).toEqual({ command: "other", args: ["run"] });
      expect(servers["kanon"]).toBeUndefined();
    });

    it("returns false when config file does not exist", () => {
      const configPath = path.join(tmpDir, "missing.toml");
      expect(removeTomlMcpConfig(configPath, "kanon")).toBe(false);
    });

    it("returns false when kanon entry is absent (no-op)", () => {
      const configPath = path.join(tmpDir, "config.toml");
      fs.writeFileSync(
        configPath,
        `
[mcp_servers.other]
command = "other"
args = ["run"]
`,
      );

      expect(removeTomlMcpConfig(configPath, "kanon")).toBe(false);
    });
  });

  describe("extractExistingAuth — codex TOML", () => {
    it("extracts static-key credentials from mcp_servers.kanon.env", () => {
      const codexHome = path.join(tmpDir, ".codex");
      fs.mkdirSync(codexHome, { recursive: true });
      const configPath = path.join(codexHome, "config.toml");
      fs.writeFileSync(
        configPath,
        `
[mcp_servers.kanon]
command = "node"
args = ["/srv.js"]

[mcp_servers.kanon.env]
KANON_API_URL = "http://localhost:4001"
KANON_API_KEY = "toml-key-123"
`,
      );

      const ctx: PlatformContext = { platform: "linux", homedir: tmpDir };
      const result = extractExistingAuth(ctx);

      expect(result.apiUrl).toBe("http://localhost:4001");
      expect(result.apiKey).toBe("toml-key-123");
    });

    it("extracts wrapper-mode apiUrl from --server argv in TOML config", () => {
      const codexHome = path.join(tmpDir, ".codex");
      fs.mkdirSync(codexHome, { recursive: true });
      const configPath = path.join(codexHome, "config.toml");
      fs.writeFileSync(
        configPath,
        `
[mcp_servers.kanon]
command = "node"
args = ["/wrapper.js", "--server", "https://server.example.com"]
`,
      );

      const ctx: PlatformContext = { platform: "linux", homedir: tmpDir };
      const result = extractExistingAuth(ctx);

      expect(result.apiUrl).toBe("https://server.example.com");
      expect(result.apiKey).toBeUndefined();
    });
  });

  describe("extractExistingWorkspaceId — TOML", () => {
    it("reads KANON_WORKSPACE_ID from mcp_servers.kanon.env", () => {
      const configPath = path.join(tmpDir, "config.toml");
      fs.writeFileSync(
        configPath,
        `
[mcp_servers.kanon]
command = "node"
args = ["/wrapper.js", "--server", "https://api.test"]

[mcp_servers.kanon.env]
KANON_WORKSPACE_ID = "ws-toml-42"
`,
      );

      expect(
        extractExistingWorkspaceId(configPath, "mcp_servers", "toml"),
      ).toBe("ws-toml-42");
    });

    it("preserves workspace identity from a legacy JSON Codex config", () => {
      const configPath = path.join(tmpDir, "config.toml");
      fs.writeFileSync(configPath, JSON.stringify({
        mcp_servers: {
          "kanon-mcp": {
            env: { KANON_WORKSPACE_ID: "ws-legacy-42" },
          },
        },
      }));

      expect(extractExistingWorkspaceId(configPath, "mcp_servers", "toml"))
        .toBe("ws-legacy-42");
    });
  });

  describe("extractExistingWorkspaceId — WSL bridge", () => {
    it("reads workspace identity from wsl env args", () => {
      const configPath = path.join(tmpDir, "mcp.json");
      fs.writeFileSync(configPath, JSON.stringify({
        mcpServers: {
          "kanon": {
            command: "wsl",
            args: [
              "env",
              "KANON_CLIENT_IDENTITY=cursor",
              "KANON_WORKSPACE_ID=workspace-from-windows",
              "node",
              "/wrapper.js",
            ],
          },
        },
      }));

      expect(extractExistingWorkspaceId(configPath, "mcpServers"))
        .toBe("workspace-from-windows");
    });
  });

  describe("installToolMcpConfig / removeToolMcpConfig dispatch", () => {
    it("routes toml tools to mergeTomlMcpConfig (not mergeConfig)", () => {
      const configPath = path.join(tmpDir, "config.toml");
      const entry: McpServerEntry = {
        command: "node",
        args: ["/srv.js"],
        env: { KANON_API_URL: "http://api.test" },
      };

      installToolMcpConfig(configPath, {
        rootKey: "mcp_servers",
        configFormat: "toml",
      }, entry);

      expect(fs.existsSync(configPath)).toBe(true);
      const parsed = parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
      expect(parsed["mcp_servers"]).toBeDefined();
    });

    it("routes json tools to mergeConfig path", () => {
      const configPath = path.join(tmpDir, "mcp.json");
      const entry: McpServerEntry = { command: "node", args: ["/srv.js"] };

      installToolMcpConfig(configPath, {
        rootKey: "mcpServers",
        configFormat: "json",
      }, entry);

      const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(parsed.mcpServers["kanon"]).toEqual(entry);
    });

    it("routes toml remove to removeTomlMcpConfig", () => {
      const configPath = path.join(tmpDir, "config.toml");
      fs.writeFileSync(
        configPath,
        `
[mcp_servers.kanon]
command = "node"
args = ["/srv.js"]
`,
      );

      const removed = removeToolMcpConfig(configPath, {
        rootKey: "mcp_servers",
        configFormat: "toml",
      });
      expect(removed).toBe(true);
    });
  });
});

describe("resolveWrapperPath — installed MCP layout", () => {
  let tmpInstallDir: string;
  let prevInstallDir: string | undefined;

  beforeEach(() => {
    tmpInstallDir = fs.mkdtempSync(path.join(os.tmpdir(), "kanon-install-"));
    prevInstallDir = process.env.KANON_INSTALL_DIR;
    process.env.KANON_INSTALL_DIR = tmpInstallDir;
  });

  afterEach(() => {
    fs.rmSync(tmpInstallDir, { recursive: true, force: true });
    if (prevInstallDir === undefined) {
      delete process.env.KANON_INSTALL_DIR;
    } else {
      process.env.KANON_INSTALL_DIR = prevInstallDir;
    }
  });

  it("resolves wrapper from install.sh layout (mcp/dist/wrapper-cli.js)", () => {
    const wrapperPath = path.join(
      tmpInstallDir,
      "mcp",
      "dist",
      "wrapper-cli.js",
    );
    fs.mkdirSync(path.dirname(wrapperPath), { recursive: true });
    fs.writeFileSync(wrapperPath, "// wrapper\n");

    const resolution = resolveWrapperPath();
    expect(resolution).toEqual({ mode: "local", path: wrapperPath });
  });

  it("throws when MCP is not installed (no npx fallback)", () => {
    expect(() => resolveWrapperPath()).toThrow(MCP_NOT_FOUND_MESSAGE);
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mergeConfig, removeConfig, buildMcpEntry } from "../mcp-config.js";

describe("mcp-config", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kanon-mcp-test-"));
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
      expect(result.mcpServers["kanon-mcp"]).toEqual(entry);
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
      expect(result.mcpServers["kanon-mcp"]).toEqual(entry);
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
      expect(result.mcpServers["kanon-mcp"]).toEqual(entry);
    });
  });

  describe("removeConfig", () => {
    it("should remove kanon entry and leave other servers intact", () => {
      const configPath = path.join(tmpDir, "mcp.json");
      const config = {
        mcpServers: {
          "other-server": { command: "other", args: [] },
          "kanon-mcp": { command: "node", args: ["server.js"] },
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(config));

      const removed = removeConfig(configPath, "mcpServers");

      expect(removed).toBe(true);
      const result = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(result.mcpServers["other-server"]).toEqual({ command: "other", args: [] });
      expect(result.mcpServers["kanon-mcp"]).toBeUndefined();
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

    it("should build a wsl-bridge npx entry", () => {
      const ctx = { platform: "wsl" as const, homedir: "/home/user", winHome: "/mnt/c/Users/User" };
      const entry = buildMcpEntry(
        { mode: "npx" },
        "http://api.test", "key123",
        ctx, "wsl-bridge", "/usr/bin/node",
      );

      expect(entry.command).toBe("wsl");
      expect(entry.args).toEqual(["env", "KANON_API_URL=http://api.test", "KANON_API_KEY=key123", "npx", "@kanon/mcp"]);
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
  });
});

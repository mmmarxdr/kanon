import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import type { ToolDefinition, PlatformContext } from "../types.js";

// Import after module is available
const { selectTools } = await import("../index.js");

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMockCtx(): PlatformContext {
  return {
    platform: "linux",
    homedir: "/home/testuser",
  };
}

function makeTool(name: string, displayName: string): ToolDefinition {
  return {
    name,
    displayName,
    rootKey: "mcpServers",
    templateSource: `${name}.md`,
    templateMode: "file-copy",
    platforms: {
      linux: {
        detect: async () => true,
        config: (ctx) => `${ctx.homedir}/.${name}/config.json`,
        skills: (ctx) => `${ctx.homedir}/.${name}/skills`,
        template: (ctx) => `${ctx.homedir}/.${name}/template.md`,
        mcpMode: "direct",
      },
    },
  };
}

const ctx = makeMockCtx();
const claude = makeTool("claude-code", "Claude Code");
const cursor = makeTool("cursor", "Cursor");
const detected = [claude, cursor];

// ── selectTools ──────────────────────────────────────────────────────────────

describe("selectTools", () => {
  describe("--tool flag", () => {
    it("should return single tool when --tool is provided", async () => {
      const result = await selectTools(
        detected,
        { tool: "claude-code" },
        false,
        ctx,
      );
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("claude-code");
    });

    it("should throw for unknown tool name", async () => {
      await expect(
        selectTools(detected, { tool: "unknown-tool" }, false, ctx),
      ).rejects.toThrow("Unknown tool: 'unknown-tool'");
    });

    it("should throw when tool does not support current platform", async () => {
      const winOnlyTool = makeTool("win-only", "Win Only");
      // Remove linux platform support
      winOnlyTool.platforms = { win32: winOnlyTool.platforms.linux! };

      // getToolByName is from the real registry, so we test with a known tool
      // Instead, test with a ctx that uses a platform the tool doesn't support
      const winCtx: PlatformContext = { platform: "win32", homedir: "C:\\Users\\test" };
      // claude-code doesn't support win32
      await expect(
        selectTools(detected, { tool: "claude-code" }, false, winCtx),
      ).rejects.toThrow("is not supported on win32");
    });

    // ── PR2 — Task 2.6 RED: --tool opencode works on linux/darwin/wsl ──────
    it("should accept --tool opencode on linux and resolve to the opencode entry", async () => {
      // The real registry now contains the opencode entry (PR2.5).
      const linuxCtx: PlatformContext = { platform: "linux", homedir: "/home/test" };
      const result = await selectTools([], { tool: "opencode" }, false, linuxCtx);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("opencode");
      expect(result[0].rootKey).toBe("mcp");
    });

    it("should accept --tool opencode on darwin", async () => {
      const darwinCtx: PlatformContext = { platform: "darwin", homedir: "/Users/test" };
      const result = await selectTools([], { tool: "opencode" }, false, darwinCtx);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("opencode");
    });

    it("should accept --tool opencode on wsl", async () => {
      const wslCtx: PlatformContext = {
        platform: "wsl",
        homedir: "/home/test",
        winHome: "/mnt/c/Users/test",
      };
      const result = await selectTools([], { tool: "opencode" }, false, wslCtx);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("opencode");
    });

    it("should reject --tool opencode on win32 (no host branch)", async () => {
      const winCtx: PlatformContext = {
        platform: "win32",
        homedir: "C:\\Users\\test",
        appDataDir: "C:\\Users\\test\\AppData\\Roaming",
      };
      await expect(
        selectTools([], { tool: "opencode" }, false, winCtx),
      ).rejects.toThrow("is not supported on win32");
    });

    it("unknown-tool error message lists opencode in supported tools", async () => {
      // The error string MUST mention all supported tools so users can
      // discover opencode. After PR2, it should include 'opencode'.
      await expect(
        selectTools(detected, { tool: "nope" }, false, ctx),
      ).rejects.toThrow(/opencode/);
    });
  });

  describe("--all flag", () => {
    it("should return all detected tools", async () => {
      const result = await selectTools(
        detected,
        { all: true },
        false,
        ctx,
      );
      expect(result).toEqual(detected);
    });
  });

  describe("--yes flag", () => {
    it("should return all detected tools without prompting", async () => {
      const result = await selectTools(
        detected,
        { yes: true },
        false,
        ctx,
      );
      expect(result).toEqual(detected);
    });
  });

  describe("no tools detected", () => {
    it("should throw when no tools are detected", async () => {
      await expect(
        selectTools([], {}, true, ctx),
      ).rejects.toThrow("No supported tools detected");
    });
  });

  describe("non-interactive (no TTY)", () => {
    it("should return all detected tools when not interactive", async () => {
      const result = await selectTools(
        detected,
        {},
        false,
        ctx,
      );
      expect(result).toEqual(detected);
    });
  });

  describe("interactive mode (TTY, no flags)", () => {
    it("should show checkbox and return selected tools", async () => {
      const promptTools = vi.fn().mockResolvedValue(["cursor"]);

      const result = await selectTools(
        detected,
        {},
        true,
        ctx,
        { promptTools },
      );

      expect(promptTools).toHaveBeenCalledWith([
        { name: "Claude Code", value: "claude-code", checked: false },
        { name: "Cursor", value: "cursor", checked: false },
      ]);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("cursor");
    });

    it("should return all tools when all are selected", async () => {
      const promptTools = vi.fn().mockResolvedValue(["claude-code", "cursor"]);

      const result = await selectTools(
        detected,
        {},
        true,
        ctx,
        { promptTools },
      );

      expect(result).toHaveLength(2);
    });

    it("preselects an existing Kanon integration", async () => {
      const homedir = fs.mkdtempSync(path.join(os.tmpdir(), "kanon-selection-"));
      try {
        const configured = makeTool("configured", "Configured Tool");
        const configuredCtx = { ...ctx, homedir };
        const configPath = configured.platforms.linux!.config(configuredCtx);
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(configPath, JSON.stringify({ mcpServers: { "kanon-mcp": {} } }));
        const promptTools = vi.fn().mockResolvedValue(["configured"]);

        await selectTools([configured], {}, true, configuredCtx, { promptTools });

        expect(promptTools).toHaveBeenCalledWith([
          { name: "Configured Tool (already configured)", value: "configured", checked: true },
        ]);
      } finally {
        fs.rmSync(homedir, { recursive: true, force: true });
      }
    });

    it("labels a legacy JSON Codex config as repairable", async () => {
      const homedir = fs.mkdtempSync(path.join(os.tmpdir(), "kanon-selection-"));
      try {
        const codex = makeTool("legacy-codex", "Codex CLI");
        codex.rootKey = "mcp_servers";
        codex.configFormat = "toml";
        const legacyCtx = { ...ctx, homedir };
        const configPath = codex.platforms.linux!.config(legacyCtx);
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(configPath, JSON.stringify({ mcp_servers: { "kanon-mcp": {} } }));
        const promptTools = vi.fn().mockResolvedValue(["legacy-codex"]);

        await selectTools([codex], {}, true, legacyCtx, { promptTools });

        expect(promptTools).toHaveBeenCalledWith([
          {
            name: "Codex CLI (legacy config will be repaired)",
            value: "legacy-codex",
            checked: false,
          },
        ]);
      } finally {
        fs.rmSync(homedir, { recursive: true, force: true });
      }
    });

    it("should exit when user deselects all tools", async () => {
      const mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
        throw new Error("process.exit called");
      }) as never);
      const promptTools = vi.fn().mockResolvedValue([]);

      await expect(
        selectTools(detected, {}, true, ctx, { promptTools }),
      ).rejects.toThrow("process.exit called");

      expect(mockExit).toHaveBeenCalledWith(0);
      mockExit.mockRestore();
    });
  });

  describe("--remove with interactive selection", () => {
    it("should allow interactive selection in remove mode (remove is handled upstream)", async () => {
      // selectTools doesn't care about --remove — that's handled in run()
      // It just selects tools based on flags. Without --tool/--all/--yes and interactive=true,
      // it shows the checkbox.
      const promptTools = vi.fn().mockResolvedValue(["claude-code"]);

      const result = await selectTools(
        detected,
        {},
        true,
        ctx,
        { promptTools },
      );

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("claude-code");
    });
  });
});

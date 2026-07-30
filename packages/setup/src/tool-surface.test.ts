import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildWrapperMcpEntry } from "./mcp-config.js";
import { getToolByName, resolveToolTargets } from "./registry.js";
import {
  cleanupLegacyToolSurface,
  installToolSurface,
  removeToolMcpSurface,
  resolveExistingToolWorkspaceId,
} from "./tool-surface.js";
import type { PlatformContext } from "./types.js";

function makeAssets(root: string): string {
  const assets = path.join(root, "assets");
  for (const skill of ["kanon-agent", "kanon-init", "kanon-onboard"]) {
    const dir = path.join(assets, "skills", skill);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), `# ${skill}\n`);
  }
  fs.mkdirSync(path.join(assets, "agents"), { recursive: true });
  fs.writeFileSync(
    path.join(assets, "agents", "kanon.md"),
    "---\nname: kanon\ndescription: Board agent\n---\n\nBody\n",
  );
  return assets;
}

describe("Cursor tool surface upgrades", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("migrates only Kanon-owned legacy config/rule files on win32", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kanon-cursor-legacy-"));
    roots.push(root);
    const ctx: PlatformContext = {
      platform: "win32",
      homedir: path.join(root, "home"),
      appDataDir: path.join(root, "appdata"),
    };
    const cursor = getToolByName("cursor")!;
    const legacyConfig = path.join(ctx.appDataDir!, "Cursor", "User", "mcp.json");
    fs.mkdirSync(path.dirname(legacyConfig), { recursive: true });
    fs.writeFileSync(legacyConfig, JSON.stringify({
      mcpServers: {
        other: { command: "other", args: [] },
        "kanon-mcp": { command: "old", args: [] },
      },
    }));
    const rulesDir = path.join(ctx.homedir, ".cursor", "rules");
    fs.mkdirSync(rulesDir, { recursive: true });
    fs.writeFileSync(path.join(rulesDir, "kanon.mdc"), "legacy-owned");
    fs.writeFileSync(path.join(rulesDir, "kanon-personal.mdc"), "user-owned");

    installToolSurface({
      tool: cursor,
      ctx,
      assetsDir: makeAssets(root),
      buildEntry: () => ({ command: "node", args: ["wrapper.js"] }),
    });

    const current = JSON.parse(
      fs.readFileSync(path.join(ctx.homedir, ".cursor", "mcp.json"), "utf8"),
    );
    const legacy = JSON.parse(fs.readFileSync(legacyConfig, "utf8"));
    expect(current.mcpServers["kanon-mcp"].type).toBe("stdio");
    expect(legacy.mcpServers.other).toBeDefined();
    expect(legacy.mcpServers["kanon-mcp"]).toBeUndefined();
    expect(fs.existsSync(path.join(rulesDir, "kanon.mdc"))).toBe(false);
    expect(fs.readFileSync(path.join(rulesDir, "kanon-personal.mdc"), "utf8"))
      .toBe("user-owned");

    const currentConfig = path.join(ctx.homedir, ".cursor", "mcp.json");
    fs.writeFileSync(legacyConfig, JSON.stringify({
      mcpServers: { "kanon-mcp": { command: "old", args: [] } },
    }));
    fs.writeFileSync(path.join(rulesDir, "kanon.mdc"), "legacy-owned");
    expect(removeToolMcpSurface(cursor, ctx)).toEqual([currentConfig]);
    expect(JSON.parse(fs.readFileSync(currentConfig, "utf8")).mcpServers["kanon-mcp"])
      .toBeUndefined();
    expect(JSON.parse(fs.readFileSync(legacyConfig, "utf8")).mcpServers["kanon-mcp"])
      .toBeUndefined();
    expect(fs.existsSync(path.join(rulesDir, "kanon.mdc"))).toBe(false);
  });

  it("reuses a Windows-only workspace ID for both WSL targets", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kanon-cursor-workspace-"));
    roots.push(root);
    const ctx: PlatformContext = {
      platform: "wsl",
      homedir: path.join(root, "linux-home"),
      winHome: path.join(root, "windows-home"),
    };
    const cursor = getToolByName("cursor")!;
    const windowsConfig = path.join(ctx.winHome!, ".cursor", "mcp.json");
    fs.mkdirSync(path.dirname(windowsConfig), { recursive: true });
    fs.writeFileSync(windowsConfig, JSON.stringify({
      mcpServers: {
        "kanon-mcp": {
          command: "wsl",
          args: ["env", "KANON_WORKSPACE_ID=workspace-from-windows", "node", "wrapper.js"],
        },
      },
    }));

    const workspaceId = resolveExistingToolWorkspaceId(cursor, ctx);
    expect(workspaceId).toBe("workspace-from-windows");
    installToolSurface({
      tool: cursor,
      ctx,
      assetsDir: makeAssets(root),
      buildEntry: (target) => buildWrapperMcpEntry(
        "https://api.test",
        target.mcpMode,
        "/usr/bin/node",
        { mode: "local", path: "/release/wrapper-cli.js" },
        workspaceId,
        cursor.clientIdentity,
      ),
    });

    const [local, windows] = resolveToolTargets(cursor, ctx).map((target) =>
      JSON.parse(fs.readFileSync(target.config(ctx), "utf8")).mcpServers["kanon-mcp"],
    );
    expect(local.env.KANON_WORKSPACE_ID).toBe("workspace-from-windows");
    expect(windows.args).toContain("KANON_WORKSPACE_ID=workspace-from-windows");
  });
});

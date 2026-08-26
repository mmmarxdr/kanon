import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { collectCursorOwnershipByTarget } from "./cursor-inventory.js";
import { getToolByName } from "./registry.js";
import type { PlatformContext } from "./types.js";

const cursor = getToolByName("cursor")!;

function makeContext(platform: PlatformContext["platform"] = "linux"): {
  root: string;
  ctx: PlatformContext;
  configPath: string;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kanon-cursor-inventory-"));
  const ctx: PlatformContext = platform === "wsl"
    ? { platform, homedir: path.join(root, "linux"), winHome: path.join(root, "windows") }
    : { platform, homedir: path.join(root, "home") };
  return { root, ctx, configPath: path.join(ctx.homedir, ".cursor", "mcp.json") };
}

describe("Cursor ownership inventory", () => {
  it.each([
    ["missing", undefined],
    ["unowned", JSON.stringify({ mcpServers: { other: { command: "node" } } })],
    ["owned", JSON.stringify({ mcpServers: { kanon: { command: "node", args: [] } } })],
    ["invalid", "{ malformed"],
  ] as const)("classifies a canonical local config as %s", (state, raw) => {
    const { root, ctx, configPath } = makeContext();
    try {
      if (raw !== undefined) {
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(configPath, raw);
      }

      expect(collectCursorOwnershipByTarget(cursor, ctx)).toEqual({
        [configPath]: { targetKey: configPath, configPath, state },
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("enumerates canonical WSL targets and reads a bridge only from an owned Windows entry", () => {
    const { root, ctx, configPath: localPath } = makeContext("wsl");
    const windowsPath = path.join(ctx.winHome!, ".cursor", "mcp.json");
    try {
      fs.mkdirSync(path.dirname(windowsPath), { recursive: true });
      fs.writeFileSync(windowsPath, JSON.stringify({
        mcpServers: {
          kanon: {
            command: "wsl",
            args: [
              "--distribution", "Ubuntu-24.04", "--", "env",
              "KANON_CLIENT_IDENTITY=cursor", "/opt/node/bin/node", "/wrapper.js",
            ],
          },
        },
      }));

      expect(collectCursorOwnershipByTarget(cursor, ctx)).toEqual({
        [localPath]: { targetKey: localPath, configPath: localPath, state: "missing" },
        [windowsPath]: {
          targetKey: windowsPath,
          configPath: windowsPath,
          state: "owned",
          bridge: { distribution: "Ubuntu-24.04", nodePath: "/opt/node/bin/node" },
        },
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("never reads a bridge from an unowned Windows config", () => {
    const { root, ctx } = makeContext("wsl");
    const windowsPath = path.join(ctx.winHome!, ".cursor", "mcp.json");
    try {
      fs.mkdirSync(path.dirname(windowsPath), { recursive: true });
      fs.writeFileSync(windowsPath, JSON.stringify({
        mcpServers: {
          other: { command: "wsl", args: ["--distribution", "Ubuntu", "--", "env", "/unsafe/node"] },
        },
      }));

      expect(collectCursorOwnershipByTarget(cursor, ctx)[windowsPath]).toEqual({
        targetKey: windowsPath,
        configPath: windowsPath,
        state: "unowned",
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

import fs from "node:fs";
import { inspectToolMcpConfig } from "./mcp-config.js";
import { resolveCursorInventoryTargets } from "./registry.js";
import type { PlatformContext, SurfaceOwnership, ToolDefinition, WslBridge } from "./types.js";

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read only the exact persisted WSL invocation from a Kanon-owned Cursor entry.
 * Discovery and executable evidence are deliberately not inputs to inventory. */
function readOwnedWindowsBridge(configPath: string, tool: ToolDefinition): WslBridge | undefined {
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as unknown;
    if (!isJsonRecord(config)) return undefined;
    const servers = config[tool.rootKey];
    if (!isJsonRecord(servers)) return undefined;
    const entry = servers["kanon"] ?? servers["kanon-mcp"];
    if (!isJsonRecord(entry) || entry["command"] !== "wsl" || !Array.isArray(entry["args"])) return undefined;
    const args = entry["args"];
    if (!args.every((arg): arg is string => typeof arg === "string")) return undefined;
    const distributionIndex = args.indexOf("--distribution");
    const distribution = args[distributionIndex + 1];
    const envIndex = args.indexOf("env");
    const nodePath = args.slice(envIndex + 1).find((arg) => !arg.includes("="));
    if (
      distributionIndex < 0 || envIndex <= distributionIndex ||
      distribution === undefined || nodePath === undefined ||
      distribution.trim().length === 0 || nodePath.trim().length === 0
    ) return undefined;
    return { distribution, nodePath };
  } catch {
    return undefined;
  }
}

/** Build lifecycle ownership by the physical target keys emitted by Cursor discovery. */
export function collectCursorOwnershipByTarget(
  tool: ToolDefinition,
  ctx: PlatformContext,
): Readonly<Record<string, SurfaceOwnership>> {
  if (tool.name !== "cursor") return {};
  const ownershipByTarget: Record<string, SurfaceOwnership> = {};

  for (const target of resolveCursorInventoryTargets(tool, ctx)) {
    const configPath = target.config(ctx);
    let state: SurfaceOwnership["state"];
    if (!fs.existsSync(configPath)) {
      state = "missing";
    } else {
      const configState = inspectToolMcpConfig(configPath, tool);
      state = configState === "configured" || configState === "legacy"
        ? "owned"
        : configState === "unconfigured"
          ? "unowned"
          : "invalid";
    }
    const ownership: SurfaceOwnership = { targetKey: configPath, configPath, state };
    if (state === "owned" && target.mcpMode === "wsl-bridge") {
      const bridge = readOwnedWindowsBridge(configPath, tool);
      if (bridge !== undefined) ownership.bridge = bridge;
    }
    ownershipByTarget[configPath] = ownership;
  }

  return ownershipByTarget;
}

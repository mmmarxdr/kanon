// ─── MCP Config Merger ───────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServerEntry, McpMode, PlatformContext } from "./types.js";

/**
 * Merge a Kanon MCP server entry into a tool's JSON config file.
 * Creates the file and parent directories if they don't exist.
 * Idempotent — overwrites the "kanon-mcp" key without touching other servers.
 */
export function mergeConfig(
  configPath: string,
  rootKey: string,
  entry: McpServerEntry,
): void {
  let config: Record<string, unknown> = {};

  try {
    const content = fs.readFileSync(configPath, "utf8");
    config = JSON.parse(content) as Record<string, unknown>;
  } catch {
    // File doesn't exist or is invalid JSON — start fresh
  }

  const servers = (config[rootKey] as Record<string, unknown>) || {};
  delete servers["kanon"];  // cleanup legacy entry from old setup-mcp.sh
  servers["kanon-mcp"] = entry;
  config[rootKey] = servers;

  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}

/**
 * Remove the "kanon-mcp" entry from a tool's JSON config.
 * Returns true if the entry was found and removed, false otherwise.
 */
export function removeConfig(configPath: string, rootKey: string): boolean {
  if (!fs.existsSync(configPath)) {
    return false;
  }

  let config: Record<string, unknown>;
  try {
    const content = fs.readFileSync(configPath, "utf8");
    config = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return false;
  }

  const servers = config[rootKey] as Record<string, unknown> | undefined;
  if (!servers || !("kanon-mcp" in servers)) {
    return false;
  }

  delete servers["kanon-mcp"];
  config[rootKey] = servers;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  return true;
}

export type McpResolution =
  | { mode: "local"; path: string }
  | { mode: "npx" };

/**
 * Build the MCP server entry for Kanon.
 *
 * Uses PlatformContext + McpMode to determine the entry format:
 * - 'direct': linux, wsl-native tools, or win32 — uses node/npx directly
 * - 'wsl-bridge': Windows-side tools invoked from WSL — uses `wsl` wrapper
 */
export function buildMcpEntry(
  resolution: McpResolution,
  apiUrl: string,
  apiKey: string,
  ctx: PlatformContext,
  mcpMode: McpMode,
  nodeBin: string,
): McpServerEntry {
  const isNpx = resolution.mode === "npx";

  if (mcpMode === "wsl-bridge") {
    // Windows-side tools invoked via WSL wrapper
    const envArgs = [`KANON_API_URL=${apiUrl}`];
    if (apiKey) {
      envArgs.push(`KANON_API_KEY=${apiKey}`);
    }
    if (isNpx) {
      return {
        command: "wsl",
        args: ["env", ...envArgs, "npx", "@kanon/mcp"],
      };
    }
    return {
      command: "wsl",
      args: ["env", ...envArgs, nodeBin, resolution.path],
    };
  }

  // Direct mode (linux, wsl-native tools, or win32)
  const env: Record<string, string> = { KANON_API_URL: apiUrl };
  if (apiKey) {
    env["KANON_API_KEY"] = apiKey;
  }

  if (isNpx) {
    return {
      command: "npx",
      args: ["@kanon/mcp"],
      env,
    };
  }

  return {
    command: nodeBin,
    args: [resolution.path],
    env,
  };
}

/**
 * Resolve how to invoke the Kanon MCP server.
 * When running from the monorepo or with @kanon/mcp installed locally,
 * returns a local path. Otherwise falls back to npx for dynamic resolution.
 */
export function resolveMcpServerPath(): McpResolution {
  // Try to find the local monorepo MCP dist
  // Use fileURLToPath() instead of .pathname to handle Windows drive letters correctly
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const localMcp = path.resolve(scriptDir, "../../mcp/dist/index.js");
  if (fs.existsSync(localMcp)) {
    return { mode: "local", path: localMcp };
  }

  // Fallback: try to find it in node_modules
  try {
    const resolved = path.resolve(
      scriptDir,
      "../../../node_modules/@kanon/mcp/dist/index.js",
    );
    if (fs.existsSync(resolved)) {
      return { mode: "local", path: resolved };
    }
  } catch {
    // ignore
  }

  // Final fallback — resolve dynamically via npx at runtime
  return { mode: "npx" };
}

/**
 * Resolve the path to the node binary.
 */
export function resolveNodeBin(): string {
  return process.execPath;
}

// ─── MCP Config Merger ───────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  McpServerEntry,
  McpMode,
  PlatformContext,
} from "./types.js";
import { toolRegistry } from "./registry.js";
import { canonicalizeApiUrl } from "./canonical-url.js";

/**
 * Union of all MCP entry shapes the setup package can write.
 *
 * - Claude / Cursor / Antigravity use `mcpServers` → object form
 *   (`{ command, args, env? }`).
 * - OpenCode uses `mcp` → array form
 *   (`{ type: "local", command: string[]; environment? }`), which preserves
 *   wrapper paths that contain spaces without shell escaping. The `type`
 *   discriminator and the `environment` key (NOT `env`) are required by
 *   OpenCode's `McpLocalConfig` schema.
 *
 * ADR: docs/adr/0005-mcp-entry-shape-per-rootkey.md (planned in PR 3).
 */
export type ToolMcpEntry =
  | McpServerEntry
  | {
      type: "local";
      command: string[];
      environment?: Record<string, string>;
      enabled?: true;
    };

/**
 * Format a Kanon MCP server entry into the shape expected by the given
 * root key:
 *
 *   - `"mcp"`        → OpenCode array form
 *     `{ type: "local", command: string[]; environment?; enabled? }`
 *   - `"mcpServers"` → object form `{ command; args[]; env? }`
 *
 * The formatter is the single source of truth for the per-rootKey schema.
 * `mergeConfig` calls it so callers can stay agnostic about which tools use
 * which shape. `removeConfig` does NOT call this formatter — it operates
 * on the raw on-disk entry by key lookup and never needs to know the
 * per-tool schema, since it only deletes the `kanon-mcp` key.
 */
export function formatMcpEntry(rootKey: string, entry: McpServerEntry): ToolMcpEntry {
  if (rootKey === "mcp") {
    // OpenCode-native shape: argv array, `environment` (NOT `env`),
    // `type: "local"` discriminator required by McpLocalConfig.
    const out: {
      type: "local";
      command: string[];
      environment?: Record<string, string>;
      enabled?: true;
    } = {
      type: "local",
      command: [entry.command, ...entry.args],
    };
    if (entry.env) out.environment = entry.env;
    return out;
  }
  // Default: object form (Claude / Cursor / Antigravity).
  return entry;
}

/**
 * Merge a Kanon MCP server entry into a tool's JSON config file.
 * Creates the file and parent directories if they don't exist.
 * Idempotent — overwrites the "kanon-mcp" key without touching other servers.
 *
 * The entry is reshaped by `formatMcpEntry(rootKey, entry)` so callers
 * can always pass the object form regardless of the target tool.
 */
export function mergeConfig(
  configPath: string,
  rootKey: string,
  entry: McpServerEntry,
): void {
  const formatted = formatMcpEntry(rootKey, entry);

  let config: Record<string, unknown> = {};

  try {
    const content = fs.readFileSync(configPath, "utf8");
    config = JSON.parse(content) as Record<string, unknown>;
  } catch {
    // File doesn't exist or is invalid JSON — start fresh
  }

  const servers = (config[rootKey] as Record<string, unknown>) || {};
  delete servers["kanon"];  // cleanup legacy entry from old setup-mcp.sh
  servers["kanon-mcp"] = formatted;
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
 *
 * NOTE: this function does NOT call `formatMcpEntry` — it operates on the
 * raw on-disk entry by key lookup and only deletes the `kanon-mcp` key,
 * regardless of whether the file uses object form (`mcpServers`) or
 * OpenCode's array form (`mcp`). It never needs to know the per-tool
 * schema.
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
export type McpEntryMode = "static-key" | "wrapper";

export function buildMcpEntry(
  resolution: McpResolution,
  apiUrl: string,
  apiKey: string,
  ctx: PlatformContext,
  mcpMode: McpMode,
  nodeBin: string,
  entryMode: McpEntryMode = "static-key",
): McpServerEntry {
  const isNpx = resolution.mode === "npx";

  // ── Wrapper mode: token-based auth, no KANON_API_KEY ─────────────────────────
  if (entryMode === "wrapper") {
    const wrapperPath = isNpx ? undefined : resolution.path;
    if (mcpMode === "wsl-bridge") {
      return {
        command: "wsl",
        args: [
          nodeBin,
          ...(wrapperPath ? [wrapperPath] : []),
          "--server",
          apiUrl,
        ],
      };
    }
    return {
      command: nodeBin,
      args: [
        ...(wrapperPath ? [wrapperPath] : []),
        "--server",
        apiUrl,
      ],
    };
  }

  // ── Static-key mode (default) ─────────────────────────────────────────────────
  if (mcpMode === "wsl-bridge") {
    // Windows-side tools invoked via WSL wrapper
    const envArgs = [`KANON_API_URL=${apiUrl}`];
    if (apiKey) {
      envArgs.push(`KANON_API_KEY=${apiKey}`);
    }
    if (isNpx) {
      return {
        command: "wsl",
        args: ["env", ...envArgs, "npx", "@kanon/mcp@>=0.3.0"],
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
      args: ["@kanon/mcp@>=0.3.0"],
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
 * Resolve how to invoke the Kanon MCP wrapper-cli.
 * Same precedence as resolveMcpServerPath but targets wrapper-cli.js so
 * onboard-mode entries point at the wrapper (refresh→exchange→spawn) rather
 * than the bare server (which expects KANON_API_KEY in env).
 */
export function resolveWrapperPath(): McpResolution {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const localWrapper = path.resolve(scriptDir, "../../mcp/dist/wrapper-cli.js");
  if (fs.existsSync(localWrapper)) {
    return { mode: "local", path: localWrapper };
  }
  try {
    const resolved = path.resolve(
      scriptDir,
      "../../../node_modules/@kanon/mcp/dist/wrapper-cli.js",
    );
    if (fs.existsSync(resolved)) {
      return { mode: "local", path: resolved };
    }
  } catch {
    // ignore
  }
  return { mode: "npx" };
}

/**
 * Build a wrapper-mode MCP server entry. The wrapper handles refresh→access
 * exchange against the server before spawning the real MCP, so no
 * KANON_API_KEY / KANON_API_URL env vars are baked in.
 *
 * @param apiUrl     - API base URL (will be canonicalized before embedding)
 * @param mcpMode    - 'direct' or 'wsl-bridge'
 * @param nodeBin    - path to node binary (default: process.execPath)
 * @param resolution - how to resolve the wrapper binary (default: auto-detect)
 * @param workspaceId - optional workspace ID; when present, emitted as
 *                     KANON_WORKSPACE_ID env var to activate SSE in the MCP child
 */
export function buildWrapperMcpEntry(
  apiUrl: string,
  mcpMode: McpMode,
  nodeBin: string = process.execPath,
  resolution: McpResolution = resolveWrapperPath(),
  workspaceId?: string,
): McpServerEntry {
  const canonUrl = canonicalizeApiUrl(apiUrl);
  const isNpx = resolution.mode === "npx";

  if (mcpMode === "wsl-bridge") {
    // wsl-bridge: no env object — args only
    return {
      command: "wsl",
      args: isNpx
        ? ["npx", "-p", "@kanon/mcp@>=0.3.0", "kanon-mcp-wrapper", "--server", canonUrl]
        : [nodeBin, resolution.path, "--server", canonUrl],
    };
  }

  if (isNpx) {
    const entry: McpServerEntry = {
      command: "npx",
      args: ["-p", "@kanon/mcp@>=0.3.0", "kanon-mcp-wrapper", "--server", canonUrl],
    };
    if (workspaceId) {
      entry.env = { KANON_WORKSPACE_ID: workspaceId };
    }
    return entry;
  }

  const entry: McpServerEntry = {
    command: nodeBin,
    args: [resolution.path, "--server", canonUrl],
  };
  if (workspaceId) {
    entry.env = { KANON_WORKSPACE_ID: workspaceId };
  }
  return entry;
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

/**
 * Shape of a parsed kanon-mcp entry as it lives on disk across all tools.
 * Object form (Claude / Cursor / Antigravity) and array form (OpenCode)
 * both reduce to this once normalized.
 *
 * - `env`        — written by Claude / Cursor / Antigravity (legacy/internal)
 * - `environment` — written by OpenCode on disk (per `McpLocalConfig`)
 *
 * Both are accepted on read so the auth extractor can pull credentials
 * from any tool's persisted file.
 */
export interface RawMcpEntry {
  command?: string | string[];
  args?: string[];
  env?: Record<string, string>;
  environment?: Record<string, string>;
}

/**
 * Pure helper: extract KANON_API_URL / KANON_API_KEY from a single raw entry,
 * handling BOTH object form (`{ command, args, env }`) and array form
 * (`{ command: string[] }`) used by OpenCode's `mcp` rootKey.
 *
 * The array form preserves wrapper paths with spaces (no shell escaping) —
 * scanning is uniform: collect argv from `command` + `args`, then look for
 * `KANON_API_URL=...`, `KANON_API_KEY=...`, or `--server <url>`.
 *
 * Exported for unit testing in isolation.
 */
export function extractAuthFromEntry(entry: RawMcpEntry): {
  apiUrl?: string;
  apiKey?: string;
} {
  const argv: string[] = [];
  if (Array.isArray(entry.command)) {
    argv.push(...entry.command);
  } else if (typeof entry.command === "string") {
    argv.push(entry.command);
    if (entry.args) argv.push(...entry.args);
  } else if (entry.args) {
    argv.push(...entry.args);
  }

  let apiUrl: string | undefined;
  let apiKey: string | undefined;

  // Read credentials from whichever env key the tool writes. Legacy/internal
  // tools (Claude / Cursor / Antigravity) use `env`; OpenCode persists
  // credentials under `environment` per its `McpLocalConfig` schema. Read
  // `environment` first, fall back to `env` when absent.
  const envMap = entry.environment ?? entry.env;
  if (envMap) {
    apiUrl = envMap["KANON_API_URL"];
    apiKey = envMap["KANON_API_KEY"];
  }

  for (const arg of argv) {
    if (!apiUrl && arg.startsWith("KANON_API_URL=")) {
      apiUrl = arg.slice("KANON_API_URL=".length);
    }
    if (!apiKey && arg.startsWith("KANON_API_KEY=")) {
      apiKey = arg.slice("KANON_API_KEY=".length);
    }
  }

  // Wrapper mode: argv contains "--server" <apiUrl> (no KANON_API_KEY in env).
  if (!apiUrl) {
    const serverIdx = argv.indexOf("--server");
    if (serverIdx !== -1 && argv[serverIdx + 1]) {
      apiUrl = argv[serverIdx + 1];
    }
  }

  const out: { apiUrl?: string; apiKey?: string } = {};
  if (apiUrl) out.apiUrl = apiUrl;
  if (apiKey) out.apiKey = apiKey;
  return out;
}

/**
 * Extract auth credentials from existing kanon-mcp entries across all tool configs.
 *
 * Scans each tool in the registry that supports the current platform, reads its
 * MCP config file, and looks for a "kanon-mcp" entry. Extracts KANON_API_URL and
 * KANON_API_KEY from:
 * - Direct mode: `entry.env.KANON_API_URL` / `entry.env.KANON_API_KEY`
 * - WSL bridge mode: parses `entry.args` array for `KANON_API_URL=xxx` patterns
 *
 * Returns the first values found. Missing files/entries are handled gracefully.
 */
export function extractExistingAuth(
  ctx: PlatformContext,
): { apiUrl?: string; apiKey?: string } {
  let apiUrl: string | undefined;
  let apiKey: string | undefined;

  for (const tool of toolRegistry) {
    const platformPaths = tool.platforms[ctx.platform];
    if (!platformPaths) continue;

    const configPath = platformPaths.config(ctx);

    let config: Record<string, unknown>;
    try {
      const content = fs.readFileSync(configPath, "utf8");
      config = JSON.parse(content) as Record<string, unknown>;
    } catch {
      // File doesn't exist or is invalid JSON — skip
      continue;
    }

    const servers = config[tool.rootKey] as
      | Record<string, unknown>
      | undefined;
    if (!servers) continue;

    const entry = servers["kanon-mcp"] as RawMcpEntry | undefined;
    if (!entry) continue;

    // Delegate parsing to the pure helper — handles both object-form and
    // array-form entries uniformly.
    const found = extractAuthFromEntry(entry);
    if (!apiUrl && found.apiUrl) apiUrl = found.apiUrl;
    if (!apiKey && found.apiKey) apiKey = found.apiKey;

    // Stop early if we have both values
    if (apiUrl && apiKey) break;
  }

  const result: { apiUrl?: string; apiKey?: string } = {};
  if (apiUrl) result.apiUrl = apiUrl;
  if (apiKey) result.apiKey = apiKey;
  return result;
}

/**
 * Extract the KANON_WORKSPACE_ID from an existing kanon-mcp entry in a tool's
 * config file, if present.
 *
 * Used during re-run (wrapper-reuse path) to preserve the workspace binding
 * already written by the initial onboarding flow.
 *
 * Returns undefined when the file doesn't exist, the entry is absent, or the
 * workspace ID was not written (older install).
 */
export function extractExistingWorkspaceId(configPath: string, rootKey: string): string | undefined {
  let config: Record<string, unknown>;
  try {
    const content = fs.readFileSync(configPath, "utf8");
    config = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return undefined;
  }

  const servers = config[rootKey] as Record<string, unknown> | undefined;
  if (!servers) return undefined;

  const entry = servers["kanon-mcp"] as
    | { env?: Record<string, string>; environment?: Record<string, string> }
    | undefined;

  // Read whichever env key the tool wrote. `environment` is the OpenCode
  // on-disk name; `env` is the legacy/internal name. Read `environment`
  // first, fall back to `env`.
  return entry?.environment?.["KANON_WORKSPACE_ID"]
    ?? entry?.env?.["KANON_WORKSPACE_ID"];
}

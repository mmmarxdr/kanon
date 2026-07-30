// ─── MCP Config Merger ───────────────────────────────────────────────────────

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "smol-toml";
import type {
  McpServerEntry,
  McpMode,
  PlatformContext,
  ToolDefinition,
} from "./types.js";
import { resolveToolTargets, toolRegistry } from "./registry.js";
import { canonicalizeApiUrl } from "./canonical-url.js";

const MCP_SERVER_NAME = "kanon";
const LEGACY_MCP_SERVER_NAME = "kanon-mcp";

function getKanonServerEntry(servers: Record<string, unknown>): unknown {
  return servers[MCP_SERVER_NAME] ?? servers[LEGACY_MCP_SERVER_NAME];
}

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
 * per-tool schema, since it only deletes Kanon's current and legacy keys.
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
 * Format a Kanon MCP entry for Codex CLI TOML config (`config.toml`).
 * Uses flat `command`/`args` with env mapped to a nested `.env` subtable.
 */
export function formatCodexMcpEntry(entry: McpServerEntry): {
  command: string;
  args: string[];
  env?: Record<string, string>;
} {
  const out: {
    command: string;
    args: string[];
    env?: Record<string, string>;
  } = {
    command: entry.command,
    args: entry.args,
  };
  if (entry.env) {
    out.env = entry.env;
  }
  return out;
}

function parseTomlConfigFile(configPath: string): Record<string, unknown> {
  let content: string;
  try {
    content = fs.readFileSync(configPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
  try {
    return parse(content) as Record<string, unknown>;
  } catch (err) {
    try {
      const legacy = JSON.parse(content) as unknown;
      if (!legacy || typeof legacy !== "object" || Array.isArray(legacy)) {
        throw new Error("not an object");
      }
      const backupPath = `${configPath}.kanon-legacy-json.bak`;
      if (!fs.existsSync(backupPath)) {
        fs.copyFileSync(configPath, backupPath);
      }
      return legacy as Record<string, unknown>;
    } catch {
      // Preserve the original TOML error because it is more actionable here.
    }
    throw new Error(
      `Invalid TOML in ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export type ToolConfigState = "configured" | "legacy" | "unconfigured" | "invalid";

/** Inspect a tool config without modifying it, for interactive selection defaults. */
export function inspectToolMcpConfig(
  configPath: string,
  tool: Pick<ToolDefinition, "rootKey" | "configFormat">,
): ToolConfigState {
  let content: string;
  try {
    content = fs.readFileSync(configPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "unconfigured";
    return "invalid";
  }

  let config: Record<string, unknown>;
  if (tool.configFormat === "toml") {
    try {
      config = parse(content) as Record<string, unknown>;
    } catch {
      try {
        const legacy = JSON.parse(content) as unknown;
        return legacy && typeof legacy === "object" && !Array.isArray(legacy)
          ? "legacy"
          : "invalid";
      } catch {
        return "invalid";
      }
    }
  } else {
    try {
      const parsedJson = JSON.parse(content) as unknown;
      if (!parsedJson || typeof parsedJson !== "object" || Array.isArray(parsedJson)) {
        return "invalid";
      }
      config = parsedJson as Record<string, unknown>;
    } catch {
      return "invalid";
    }
  }

  const servers = config[tool.rootKey];
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    return "unconfigured";
  }
  return MCP_SERVER_NAME in servers || LEGACY_MCP_SERVER_NAME in servers
    ? "configured"
    : "unconfigured";
}

/**
 * Merge a Kanon MCP server entry into a Codex CLI TOML config file.
 * Idempotent — overwrites only the named server entry.
 */
export function mergeTomlMcpConfig(
  configPath: string,
  serverName: string,
  entry: ReturnType<typeof formatCodexMcpEntry>,
): void {
  const config = parseTomlConfigFile(configPath);

  const servers = (config["mcp_servers"] as Record<string, unknown>) || {};
  if (serverName === MCP_SERVER_NAME) delete servers[LEGACY_MCP_SERVER_NAME];

  const serverEntry: Record<string, unknown> = {
    command: entry.command,
    args: entry.args,
  };
  if (entry.env) {
    serverEntry["env"] = entry.env;
  }

  servers[serverName] = serverEntry;
  config["mcp_servers"] = servers;

  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(configPath, stringify(config) + "\n");
}

/**
 * Remove a named MCP server from a Codex CLI TOML config file.
 */
export function removeTomlMcpConfig(
  configPath: string,
  serverName: string,
): boolean {
  if (!fs.existsSync(configPath)) {
    return false;
  }

  let config: Record<string, unknown>;
  try {
    config = parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
  } catch {
    return false;
  }

  const servers = config["mcp_servers"] as Record<string, unknown> | undefined;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    return false;
  }

  const names = serverName === MCP_SERVER_NAME
    ? [MCP_SERVER_NAME, LEGACY_MCP_SERVER_NAME]
    : [serverName];
  let removed = false;
  for (const name of names) {
    if (name in servers) {
      delete servers[name];
      removed = true;
    }
  }
  if (!removed) return false;
  config["mcp_servers"] = servers;
  fs.writeFileSync(configPath, stringify(config) + "\n");
  return true;
}

/**
 * Install MCP config using the correct merge path for the tool's config format.
 */
export function installToolMcpConfig(
  configPath: string,
  tool: Pick<ToolDefinition, "rootKey" | "configFormat">,
  entry: McpServerEntry,
): void {
  if (tool.configFormat === "toml") {
    mergeTomlMcpConfig(configPath, MCP_SERVER_NAME, formatCodexMcpEntry(entry));
    return;
  }
  mergeConfig(configPath, tool.rootKey, entry);
}

/**
 * Remove MCP config using the correct path for the tool's config format.
 */
export function removeToolMcpConfig(
  configPath: string,
  tool: Pick<ToolDefinition, "rootKey" | "configFormat">,
): boolean {
  if (tool.configFormat === "toml") {
    return removeTomlMcpConfig(configPath, MCP_SERVER_NAME);
  }
  return removeConfig(configPath, tool.rootKey);
}

/**
 * Merge a Kanon MCP server entry into a tool's JSON config file.
 * Creates the file and parent directories if they don't exist.
 * Idempotent — overwrites the "kanon" key without touching other servers.
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

  let content: string | undefined;
  try {
    content = fs.readFileSync(configPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  if (content !== undefined) {
    try {
      config = JSON.parse(content) as Record<string, unknown>;
    } catch (err) {
      throw new Error(
        `Invalid JSON in ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const servers = (config[rootKey] as Record<string, unknown>) || {};
  delete servers[LEGACY_MCP_SERVER_NAME];
  servers[MCP_SERVER_NAME] = formatted;
  config[rootKey] = servers;

  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}

/**
 * Remove current and legacy Kanon entries from a tool's JSON config.
 * Returns true if the entry was found and removed, false otherwise.
 *
 * NOTE: this function does NOT call `formatMcpEntry` — it operates on the
 * raw on-disk entry by key lookup and only deletes Kanon's exact keys,
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
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    return false;
  }

  let removed = false;
  for (const name of [MCP_SERVER_NAME, LEGACY_MCP_SERVER_NAME]) {
    if (name in servers) {
      delete servers[name];
      removed = true;
    }
  }
  if (!removed) return false;
  config[rootKey] = servers;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  return true;
}

export type McpResolution = { mode: "local"; path: string };

export const MCP_NOT_FOUND_MESSAGE =
  "Kanon MCP not found. Install via the signed release tarball first (install.sh or install.ps1 — see docs/AI_TOOLS.md).";

/**
 * Candidate paths for MCP binaries installed via install.sh (~/.kanon/mcp).
 * Tarball layout nests under `mcp/dist/`; flat `dist/` is accepted as fallback.
 */
function resolveInstalledMcpPaths(
  basename: "wrapper-cli.js" | "index.js",
): string[] {
  const installDir =
    process.env["KANON_INSTALL_DIR"] ?? path.join(os.homedir(), ".kanon", "mcp");
  return [
    path.join(installDir, "mcp", "dist", basename),
    path.join(installDir, "dist", basename),
  ];
}

function firstExistingPath(candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function requireLocalMcpResolution(
  label: "wrapper-cli.js" | "index.js",
  candidates: string[],
): McpResolution {
  const found = firstExistingPath(candidates);
  if (found) {
    return { mode: "local", path: found };
  }
  throw new Error(MCP_NOT_FOUND_MESSAGE);
}

/**
 * Build the MCP server entry for Kanon.
 *
 * Uses PlatformContext + McpMode to determine the entry format:
 * - 'direct': linux, wsl-native tools, or win32 — uses node + local MCP path
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
  clientIdentity?: string,
  workspaceId?: string,
): McpServerEntry {
  const identityEnv: Record<string, string> = {};
  if (clientIdentity) identityEnv["KANON_CLIENT_IDENTITY"] = clientIdentity;
  if (workspaceId) identityEnv["KANON_WORKSPACE_ID"] = workspaceId;

  // ── Wrapper mode: token-based auth, no KANON_API_KEY ─────────────────────────
  if (entryMode === "wrapper") {
    if (mcpMode === "wsl-bridge") {
      return {
        command: "wsl",
        args: [
          "env",
          ...Object.entries(identityEnv).map(([key, value]) => `${key}=${value}`),
          nodeBin,
          resolution.path,
          "--server",
          apiUrl,
        ],
      };
    }
    const entry: McpServerEntry = {
      command: nodeBin,
      args: [resolution.path, "--server", apiUrl],
    };
    if (Object.keys(identityEnv).length > 0) entry.env = identityEnv;
    return entry;
  }

  // ── Static-key mode (default) ─────────────────────────────────────────────────
  if (mcpMode === "wsl-bridge") {
    const envArgs = [`KANON_API_URL=${apiUrl}`];
    if (apiKey) {
      envArgs.push(`KANON_API_KEY=${apiKey}`);
    }
    envArgs.push(
      ...Object.entries(identityEnv).map(([key, value]) => `${key}=${value}`),
    );
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
  Object.assign(env, identityEnv);

  return {
    command: nodeBin,
    args: [resolution.path],
    env,
  };
}

/**
 * Resolve how to invoke the Kanon MCP wrapper-cli.
 *
 * Search order:
 *   1. Installed release (~/.kanon/mcp or strict KANON_INSTALL_DIR)
 *   2. Relative packaged/development layout (setup/dist → mcp/dist)
 *   3. Monorepo node_modules (@kanon/mcp)
 *
 * No npx fallback — @kanon/mcp is not published to npm; distribution is tarball-only.
 */
export function resolveWrapperPath(): McpResolution {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const installed = resolveInstalledMcpPaths("wrapper-cli.js");
  const candidates = process.env["KANON_INSTALL_DIR"]
    ? installed
    : [
        ...installed,
        path.resolve(scriptDir, "../../mcp/dist/wrapper-cli.js"),
        path.resolve(
          scriptDir,
          "../../../node_modules/@kanon/mcp/dist/wrapper-cli.js",
        ),
      ];
  return requireLocalMcpResolution("wrapper-cli.js", candidates);
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
  clientIdentity?: string,
): McpServerEntry {
  const canonUrl = canonicalizeApiUrl(apiUrl);
  const env: Record<string, string> = {};
  if (clientIdentity) env["KANON_CLIENT_IDENTITY"] = clientIdentity;
  if (workspaceId) env["KANON_WORKSPACE_ID"] = workspaceId;

  if (mcpMode === "wsl-bridge") {
    return {
      command: "wsl",
      args: [
        "env",
        ...Object.entries(env).map(([key, value]) => `${key}=${value}`),
        nodeBin,
        resolution.path,
        "--server",
        canonUrl,
      ],
    };
  }

  const entry: McpServerEntry = {
    command: nodeBin,
    args: [resolution.path, "--server", canonUrl],
  };
  if (Object.keys(env).length > 0) entry.env = env;
  return entry;
}

/**
 * Resolve how to invoke the Kanon MCP server (static-key mode).
 * Same search order as resolveWrapperPath(); throws if not found.
 */
export function resolveMcpServerPath(): McpResolution {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const installed = resolveInstalledMcpPaths("index.js");
  const candidates = process.env["KANON_INSTALL_DIR"]
    ? installed
    : [
        ...installed,
        path.resolve(scriptDir, "../../mcp/dist/index.js"),
        path.resolve(
          scriptDir,
          "../../../node_modules/@kanon/mcp/dist/index.js",
        ),
      ];
  return requireLocalMcpResolution("index.js", candidates);
}

/**
 * Resolve the path to the node binary.
 */
export function resolveNodeBin(): string {
  return process.execPath;
}

/**
 * Shape of a parsed Kanon MCP entry as it lives on disk across all tools.
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
 * Extract auth credentials from current or legacy Kanon entries across all tool configs.
 *
 * Scans each tool in the registry that supports the current platform, reads its
 * MCP config file, and looks for a `kanon` or legacy `kanon-mcp` entry. Extracts KANON_API_URL and
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

  outer: for (const tool of toolRegistry) {
    for (const platformPaths of resolveToolTargets(tool, ctx)) {
      const configPath = platformPaths.config(ctx);

      if (tool.configFormat === "toml") {
        let config: Record<string, unknown>;
        try {
          const content = fs.readFileSync(configPath, "utf8");
          config = parse(content) as Record<string, unknown>;
        } catch {
          continue;
        }

        const servers = config[tool.rootKey] as
          | Record<string, unknown>
          | undefined;
        if (!servers) continue;

        const raw = getKanonServerEntry(servers) as RawMcpEntry | undefined;
        if (!raw) continue;

        const entry: RawMcpEntry = {
          command: raw.command,
          args: raw.args,
          env: raw.env,
        };

        const found = extractAuthFromEntry(entry);
        if (!apiUrl && found.apiUrl) apiUrl = found.apiUrl;
        if (!apiKey && found.apiKey) apiKey = found.apiKey;

        if (apiUrl && apiKey) break outer;
        continue;
      }

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

      const entry = getKanonServerEntry(servers) as RawMcpEntry | undefined;
      if (!entry) continue;

      // Delegate parsing to the pure helper — handles both object-form and
      // array-form entries uniformly.
      const found = extractAuthFromEntry(entry);
      if (!apiUrl && found.apiUrl) apiUrl = found.apiUrl;
      if (!apiKey && found.apiKey) apiKey = found.apiKey;

      if (apiUrl && apiKey) break outer;
    }
  }

  const result: { apiUrl?: string; apiKey?: string } = {};
  if (apiUrl) result.apiUrl = apiUrl;
  if (apiKey) result.apiKey = apiKey;
  return result;
}

/**
 * Extract the KANON_WORKSPACE_ID from an existing current or legacy Kanon entry in a tool's
 * config file, if present.
 *
 * Used during re-run (wrapper-reuse path) to preserve the workspace binding
 * already written by the initial onboarding flow.
 *
 * Returns undefined when the file doesn't exist, the entry is absent, or the
 * workspace ID was not written (older install).
 */
export function extractExistingWorkspaceId(
  configPath: string,
  rootKey: string,
  configFormat?: "json" | "toml",
): string | undefined {
  if (configFormat === "toml") {
    try {
      const content = fs.readFileSync(configPath, "utf8");
      let config: Record<string, unknown>;
      try {
        config = parse(content) as Record<string, unknown>;
      } catch {
        config = JSON.parse(content) as Record<string, unknown>;
      }
      const servers = config[rootKey] as Record<string, unknown> | undefined;
      if (!servers) return undefined;

      const entry = getKanonServerEntry(servers) as { env?: Record<string, string> } | undefined;
      return entry?.env?.["KANON_WORKSPACE_ID"];
    } catch {
      return undefined;
    }
  }

  let config: Record<string, unknown>;
  try {
    const content = fs.readFileSync(configPath, "utf8");
    config = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return undefined;
  }

  const servers = config[rootKey] as Record<string, unknown> | undefined;
  if (!servers) return undefined;

  const entry = getKanonServerEntry(servers) as
    | {
        args?: string[];
        env?: Record<string, string>;
        environment?: Record<string, string>;
      }
    | undefined;

  // Read whichever env key the tool wrote. `environment` is the OpenCode
  // on-disk name; `env` is the legacy/internal name. Read `environment`
  // first, fall back to `env`.
  const fromEnv = entry?.environment?.["KANON_WORKSPACE_ID"]
    ?? entry?.env?.["KANON_WORKSPACE_ID"];
  if (fromEnv) return fromEnv;
  return entry?.args
    ?.find((arg) => arg.startsWith("KANON_WORKSPACE_ID="))
    ?.slice("KANON_WORKSPACE_ID=".length);
}

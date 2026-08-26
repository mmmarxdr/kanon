import fs from "node:fs";
import path from "node:path";
import { spawnSync as nodeSpawnSync } from "node:child_process";
import type { PlatformContext, SurfaceAuthorization, SurfaceEvidence, WslBridge } from "./types.js";

const PROBE_TIMEOUT_MS = 3000;
const PROBE_MAX_BUFFER = 8192;
const CLI_ALIASES = ["cursor", "agent", "cursor-agent"];
const WSL_EXECUTABLE = "wsl.exe";

type ProbeResult = { status: number | null; stdout?: string | Buffer; stderr?: string | Buffer; error?: Error };
type SpawnSync = (file: string, args: readonly string[], options: { cwd: string; shell: false; timeout: number; maxBuffer: number; encoding: "utf8"; windowsVerbatimArguments?: boolean }) => ProbeResult;

export interface CursorSurfaceDeps {
  existsSync?: (candidate: string) => boolean;
  resolveCommand?: (command: string) => string | undefined;
  resolveIdeExecutable?: (ctx: PlatformContext) => string | undefined;
  spawnSync?: SpawnSync;
  listWslDistributions?: () => readonly string[];
}


function resolveDefaultCommand(command: string, existsSync: (candidate: string) => boolean): string | undefined {
  const separator = process.platform === "win32" ? ";" : ":";
  const extensions = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const directory of (process.env["PATH"] ?? "").split(separator)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`);
      if (directory && existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

function resolveDefaultIdeExecutable(ctx: PlatformContext, existsSync: (candidate: string) => boolean): string | undefined {
  // Managed Windows installs use official Program Files roots and need not
  // create .cursor until first launch. Keep discovery bounded to those roots.
  const windowsRoots = [process.env["ProgramW6432"], process.env["ProgramFiles"], process.env["ProgramFiles(x86)"]]
    .filter((root): root is string => typeof root === "string" && root.length > 0)
    .map((root) => path.join(root, "Cursor", "Cursor.exe"));
  const roots = ctx.platform === "win32"
    ? [path.join(ctx.appDataDir ?? path.join(ctx.homedir, "AppData", "Roaming"), "..", "Local", "Programs", "cursor", "Cursor.exe"), ...windowsRoots]
    : ctx.platform === "darwin"
      ? ["/Applications/Cursor.app/Contents/MacOS/Cursor", path.join(ctx.homedir, "Applications", "Cursor.app", "Contents", "MacOS", "Cursor")]
      : ["/usr/bin/cursor", "/usr/local/bin/cursor"];
  return roots.find(existsSync);
}

function safeCwd(executable: string): string {
  const directory = path.dirname(executable);
  return executable.startsWith("\\\\") ? process.cwd() : directory || process.cwd();
}

function batchVersionCommand(executable: string): string | undefined {
  // cmd.exe parses its final /c argument. Reject every metacharacter that can
  // alter that command rather than attempting shell escaping. The remaining
  // nested quotes are the documented cmd.exe form for a spaced executable:
  // the outer pair survives /s and the inner pair delimits the batch path.
  if (/["\r\n&|<>()^%!]/.test(executable)) return undefined;
  return `""${executable}" --version"`;
}

/**
 * Cursor.exe is the desktop application, not a command-line version endpoint.
 * A resolved official install path is therefore sufficient IDE evidence; do not
 * spawn it during setup discovery because that launches the user's editor.
 */
function cursorIdeEvidence(executable: string): SurfaceEvidence {
  return {
    tool: "cursor",
    surface: "ide",
    host: "local",
    state: "executable-valid",
    executable: { path: executable, command: executable, version: "unprobed" },
  };
}

export function probeCursorExecutable(executable: string, deps: Pick<CursorSurfaceDeps, "spawnSync"> = {}): SurfaceEvidence {
  // `where cursor` can resolve the desktop executable itself, including either
  // filename casing. Treat that as evidence only: Cursor.exe launches the IDE,
  // it is not a supported CLI probe endpoint.
  if (/\.exe$/i.test(executable)) {
    return {
      tool: "cursor", surface: "cli", host: "local", state: "executable-valid",
      executable: { path: executable, command: executable, version: "unprobed" },
    };
  }
  const spawnSync = deps.spawnSync ?? ((file, args, options) => nodeSpawnSync(file, args, options) as ProbeResult);
  const options = { cwd: safeCwd(executable), shell: false as const, timeout: PROBE_TIMEOUT_MS, maxBuffer: PROBE_MAX_BUFFER, encoding: "utf8" as const, windowsVerbatimArguments: process.platform === "win32" };
  // Node cannot directly execute a batch alias with shell:false. Invoke the
  // Windows command host as an explicit argv adapter; never enable a shell.
  const isBatchAlias = /\.(?:cmd|bat)$/i.test(executable);
  const command = isBatchAlias ? batchVersionCommand(executable) : undefined;
  if (isBatchAlias && command === undefined) {
    return { tool: "cursor", surface: "cli", host: "local", state: "configured-only/stale" };
  }
  const result = command === undefined
    ? spawnSync(executable, ["--version"], options)
    : spawnSync(process.env["ComSpec"] ?? "cmd.exe", ["/d", "/s", "/c", command], options);
  const version = String(result.stdout ?? "").trim().split(/\s+/)[0];
  return {
    tool: "cursor", surface: "cli", host: "local",
    state: result.status === 0 && version ? "executable-valid" : "configured-only/stale",
    ...(result.status === 0 && version ? { executable: { path: executable, command: executable, version } } : {}),
  };
}

function listWslDistributions(spawnSync: SpawnSync): readonly string[] {
  const result = spawnSync(WSL_EXECUTABLE, ["--list", "--quiet"], {
    cwd: process.cwd(), shell: false, timeout: PROBE_TIMEOUT_MS, maxBuffer: PROBE_MAX_BUFFER, encoding: "utf8",
  });
  if (result.status !== 0) return [];
  return String(result.stdout ?? "").split(/\r?\n/).map((value) => value.replace(/\0/g, "").trim()).filter(Boolean);
}

function bridgeEvidence(ctx: PlatformContext, deps: CursorSurfaceDeps): SurfaceEvidence {
  const existsSync = deps.existsSync ?? fs.existsSync;
  const root = path.join(ctx.winHome!, ".cursor");
  const targetKey = path.join(root, "mcp.json");
  const distributions = deps.listWslDistributions?.() ?? listWslDistributions(deps.spawnSync ?? ((file, args, options) => nodeSpawnSync(file, args, options) as ProbeResult));
  if (distributions.length !== 1) return { tool: "cursor", surface: "ide", host: "windows", state: existsSync(root) ? "ambiguous" : "absent", targetKey };
  const bridge = { distribution: distributions[0]!, nodePath: process.execPath };
  // The config directory proves only configuration history. A resolved
  // official Cursor.exe path supplies non-launching IDE evidence.
  const driveRoot = path.resolve(ctx.winHome!, "..", "..");
  const executables = [
    path.join(ctx.winHome!, "AppData", "Local", "Programs", "cursor", "Cursor.exe"),
    path.join(driveRoot, "Program Files", "Cursor", "Cursor.exe"),
    path.join(driveRoot, "Program Files (x86)", "Cursor", "Cursor.exe"),
  ];
  const executable = executables.find(existsSync);
  if (!executable) return { tool: "cursor", surface: "ide", host: "windows", state: existsSync(root) ? "wsl-only/bridge" : "absent", bridge, targetKey };
  const probe = cursorIdeEvidence(executable);
  return { ...probe, surface: "ide", host: "windows", bridge, targetKey };
}

export function discoverCursorSurfaces(ctx: PlatformContext, deps: CursorSurfaceDeps = {}): readonly SurfaceEvidence[] {
  const existsSync = deps.existsSync ?? fs.existsSync;
  const ideRoot = path.join(ctx.homedir, ".cursor");
  const ideExecutable = deps.resolveIdeExecutable?.(ctx) ?? resolveDefaultIdeExecutable(ctx, existsSync);
  const surfaces: SurfaceEvidence[] = existsSync(ideRoot) || ideExecutable !== undefined
    ? [ideExecutable === undefined
      ? { tool: "cursor", surface: "ide", host: "local", state: "configured-only/stale", targetKey: path.join(ideRoot, "mcp.json") }
      : { ...cursorIdeEvidence(ideExecutable), targetKey: path.join(ideRoot, "mcp.json") }]
    : [];
  const aliases = CLI_ALIASES
    .map((alias) => deps.resolveCommand?.(alias) ?? resolveDefaultCommand(alias, existsSync))
    .filter((candidate): candidate is string => candidate !== undefined)
    .filter((candidate, index, all) => all.indexOf(candidate) === index);
  let stale: SurfaceEvidence | undefined;
  for (const alias of aliases) {
    const evidence = probeCursorExecutable(alias, deps);
    const withTarget = { ...evidence, targetKey: path.join(ctx.homedir, ".cursor", "mcp.json") };
    if (withTarget.state === "executable-valid") {
      surfaces.push(withTarget);
      break;
    }
    stale = withTarget;
  }
  if (stale !== undefined && !surfaces.some((surface) => surface.surface === "cli")) surfaces.push(stale);
  if (ctx.platform === "wsl" && ctx.winHome) surfaces.push(bridgeEvidence(ctx, deps));
  return surfaces;
}

export function resolveCursorAuthorization(
  flags: { tool?: string; all?: boolean },
  isInteractive: boolean,
  bridge?: WslBridge,
  promptAccepted = false,
): SurfaceAuthorization {
  // A TTY is capability, not consent. Prompt authorization is supplied only
  // after a real affirmative prompt result by the caller; this low-level
  // planner therefore fails closed for all implicit flows.
  const source = flags.tool === "cursor" ? "explicit" : promptAccepted ? "prompt" : flags.all ? "all" : "autodetect";
  return { source, crossHost: source === "explicit" || source === "prompt" ? "authorized" : "denied", ...(bridge ? { bridge } : {}) };
}

/** Validate the exact WSL distribution that will be persisted in a Windows MCP entry. */
export function validateWslBridge(
  bridge: WslBridge,
  deps: Pick<CursorSurfaceDeps, "spawnSync"> = {},
): boolean {
  const nodePath = bridge.nodePath ?? process.execPath;
  if (!path.isAbsolute(nodePath)) return false;
  const spawnSync = deps.spawnSync ?? ((file, args, options) => nodeSpawnSync(file, args, options) as ProbeResult);
  const result = spawnSync(WSL_EXECUTABLE, ["--distribution", bridge.distribution, "--exec", nodePath, "--version"], {
    cwd: process.cwd(), shell: false, timeout: PROBE_TIMEOUT_MS, maxBuffer: PROBE_MAX_BUFFER, encoding: "utf8",
  });
  return result.status === 0 && String(result.stdout ?? "").trim().length > 0;
}

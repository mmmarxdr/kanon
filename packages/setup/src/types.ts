// ─── Types ───────────────────────────────────────────────────────────────────

// ─── Platform Types (cross-platform refactor) ────────────────────────────────

export type Platform = "win32" | "wsl" | "linux" | "darwin";

export interface PlatformContext {
  platform: Platform;
  homedir: string; // os.homedir() — on WSL this is /home/user
  winHome?: string; // /mnt/c/Users/X (WSL only)
  appDataDir?: string; // %APPDATA% resolved (win32 only)
}

export type McpMode = "direct" | "wsl-bridge";

export interface PlatformPaths {
  detect: (ctx: PlatformContext) => Promise<boolean>;
  config: (ctx: PlatformContext) => string;
  skills: (ctx: PlatformContext) => string;
  workflows?: (ctx: PlatformContext) => string;
  agents?: (ctx: PlatformContext) => string;
  /**
   * Optional: when present, setup writes a `template` file (e.g. Claude's
   * `CLAUDE.md`, Cursor's `kanon.mdc`, Gemini's `GEMINI.md`). When absent,
   * setup MUST NOT write a personal harness file for this tool — used by
   * OpenCode, which is a product surface only.
   */
  template?: (ctx: PlatformContext) => string;
  /**
   * Optional: when present, setup installs slash-command files
   * (`assets/commands/<name>.md`) into this directory. Used by OpenCode
   * (writes to `~/.config/opencode/commands/`).
   */
  commands?: (ctx: PlatformContext) => string;
  mcpMode: McpMode;
}

// ─── Tool Definition ─────────────────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  displayName: string;
  rootKey: string;
  /** On-disk config format — default `"json"` (Claude / Cursor / Antigravity / OpenCode). */
  configFormat?: "json" | "toml";
  mcpType?: "stdio";
  clientIdentity?: string;
  templateSource: string;
  templateMode: "marker-inject" | "file-copy";

  // Per-platform paths map — each tool declares which platforms it supports
  platforms: Partial<Record<Platform, PlatformPaths>>;
}

export interface McpServerEntry {
  type?: "stdio";
  command: string;
  args: string[];
  env?: Record<string, string>;
}

// ─── Auth Types ─────────────────────────────────────────────────────────────

/** Source that resolved an auth field, for logging */
export type AuthSource =
  | "flag"
  | "env"
  | "existing-config"
  | "auto-generated"
  | "prompt";

export interface AuthResult {
  apiUrl: string;
  apiKey: string;
  urlSource: AuthSource;
  keySource: AuthSource;
}

/** Injectable dependencies for resolveAuth — enables testing without mocks */
export interface AuthDeps {
  extractExisting?: (
    ctx: PlatformContext,
  ) => { apiUrl?: string; apiKey?: string };
  // NOTE: autoGenerateKey was removed in PR1 (KAN-35) — POST /api/auth/api-key is gone.
  // Use the installer for onboarding: bash -c "$(curl -fsSL .../install.sh)"
  promptUrl?: () => Promise<string>;
  promptKey?: () => Promise<string>;
  fetchFn?: typeof globalThis.fetch;
}

// ─── Interactive Options ────────────────────────────────────────────────────

export interface InteractiveOptions {
  yes: boolean;
  interactive: boolean;
}

// ─── Surface Lifecycle Types ────────────────────────────────────────────────

export type EvidenceState =
  | "executable-valid"
  | "configured-only/stale"
  | "wsl-only/bridge"
  | "ambiguous"
  | "absent";

export interface WslBridge {
  distribution: string;
  /** Exact absolute Node executable validated in this WSL distribution. */
  nodePath?: string;
}

export interface SurfaceEvidence {
  tool: string;
  surface: string;
  host: "local" | "windows";
  state: EvidenceState;
  bridge?: WslBridge;
  executable?: {
    path: string;
    command: string;
    version: string;
  };
  targetKey?: string;
}

export interface SurfaceAuthorization {
  source: "explicit" | "all" | "autodetect" | "prompt" | "inventory";
  crossHost: "authorized" | "denied";
  bridge?: WslBridge;
}

export interface SurfaceOwnership {
  targetKey: string;
  configPath: string;
  state: "owned" | "unowned" | "missing" | "invalid";
  bridge?: WslBridge;
}

export interface SurfaceMutationPlan {
  operation: "configure" | "repair" | "remove";
  evidence: SurfaceEvidence;
  authorization: SurfaceAuthorization;
  ownership: SurfaceOwnership;
  decision: "write" | "skip";
  mutations: readonly string[];
  bridge?: WslBridge;
  reason: string;
}

export interface SurfaceResult {
  surface: string;
  host: string;
  evidence: EvidenceState;
  outcome: "ready" | "removed" | "skipped" | "failed";
  paths: readonly string[];
  message: string;
}

export interface SetupOutcome {
  kind: "configured" | "manual-fallback" | "explicit-non-success";
  exitCode: 0 | 1;
  manualMcpPath?: string;
  surfaces: readonly SurfaceResult[];
}

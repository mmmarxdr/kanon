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
  template: (ctx: PlatformContext) => string;
  mcpMode: McpMode;
}

// ─── Tool Definition ─────────────────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  displayName: string;
  rootKey: string;
  templateSource: string;
  templateMode: "marker-inject" | "file-copy";

  // Per-platform paths map — each tool declares which platforms it supports
  platforms: Partial<Record<Platform, PlatformPaths>>;
}

export interface McpServerEntry {
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

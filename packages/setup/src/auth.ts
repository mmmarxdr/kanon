// ─── Auth Resolution ─────────────────────────────────────────────────────────

import { input, password } from "@inquirer/prompts";
import type { AuthResult, AuthDeps, PlatformContext } from "./types.js";
import { extractExistingAuth } from "./mcp-config.js";

/**
 * Check if a URL points to a localhost address.
 * Matches: localhost, 127.0.0.1, ::1, 0.0.0.0
 */
export function isLocalhost(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    // Node's WHATWG URL keeps IPv6 brackets in hostname — "[::1]" not "::1"
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "[::1]" ||
      host === "0.0.0.0"
    );
  } catch {
    return false;
  }
}

/**
 * Resolve API URL and key with a cascade:
 *   1. CLI flags
 *   2. Environment variables
 *   3. Existing MCP config extraction
 *   4. Auto-detect localhost URL (health check)
 *   5. Interactive prompt
 *
 * NOTE: Auto-generation of API keys via POST /api/auth/api-key was removed in PR1 (KAN-35).
 * Key resolution no longer has an auto-generate step — use the installer to onboard:
 *   bash -c "$(curl -fsSL https://raw.githubusercontent.com/mmmarxdr/kanon/mcp-v0.4.0/install.sh)"
 */
export async function resolveAuth(
  options: { apiUrl?: string; apiKey?: string; yes?: boolean },
  ctx: PlatformContext,
  deps?: AuthDeps,
): Promise<AuthResult> {
  const _extractExisting = deps?.extractExisting ?? extractExistingAuth;
  const _promptUrl = deps?.promptUrl ?? defaultPromptUrl;
  const _promptKey = deps?.promptKey ?? defaultPromptKey;
  const _fetchFn = deps?.fetchFn ?? globalThis.fetch;

  let apiUrl: string | undefined;
  let urlSource: AuthResult["urlSource"] = "flag";

  // ── Resolve URL ────────────────────────────────────────────────────

  // Step 1: Flag
  if (options.apiUrl) {
    apiUrl = options.apiUrl;
    urlSource = "flag";
  }

  // Step 2: Env
  if (!apiUrl && process.env["KANON_API_URL"]) {
    apiUrl = process.env["KANON_API_URL"];
    urlSource = "env";
  }

  // Step 3: Existing config
  if (!apiUrl) {
    const existing = _extractExisting(ctx);
    if (existing.apiUrl) {
      apiUrl = existing.apiUrl;
      urlSource = "existing-config";
    }
  }

  // Step 4: Auto-detect localhost
  if (!apiUrl) {
    try {
      const healthResp = await _fetchFn("http://localhost:3000/health");
      if (healthResp.ok) {
        apiUrl = "http://localhost:3000";
        urlSource = "auto-generated";
      }
    } catch {
      // localhost not running — fall through
    }
  }

  // Step 5: Interactive prompt
  if (!apiUrl) {
    if (options.yes || !process.stdin.isTTY) {
      throw new Error(
        "API URL could not be resolved automatically. " +
          "Provide via --api-url flag or KANON_API_URL env var.",
      );
    }
    apiUrl = await _promptUrl();
    urlSource = "prompt";
  }

  if (!apiUrl) {
    throw new Error(
      "API URL is required. Provide via --api-url, KANON_API_URL env var, or enter it when prompted.",
    );
  }

  // ── Resolve Key ────────────────────────────────────────────────────

  let apiKey: string | undefined;
  let keySource: AuthResult["keySource"] = "flag";

  // Step 1: Flag
  if (options.apiKey) {
    apiKey = options.apiKey;
    keySource = "flag";
  }

  // Step 2: Env
  if (!apiKey && process.env["KANON_API_KEY"]) {
    apiKey = process.env["KANON_API_KEY"];
    keySource = "env";
  }

  // Step 3: Existing config
  if (!apiKey) {
    const existing = _extractExisting(ctx);
    if (existing.apiKey) {
      apiKey = existing.apiKey;
      keySource = "existing-config";
    }
  }

  // Step 4: Interactive prompt
  if (!apiKey) {
    if (options.yes || !process.stdin.isTTY) {
      throw new Error(
        "API key could not be resolved automatically. " +
          "Provide via --api-key flag or KANON_API_KEY env var.",
      );
    }
    apiKey = await _promptKey();
    keySource = "prompt";
  }

  return { apiUrl, apiKey: apiKey ?? "", urlSource, keySource };
}

// ── Default prompt implementations ──────────────────────────────────────────

async function defaultPromptUrl(): Promise<string> {
  return input({
    message: "Kanon API URL:",
    default: "http://localhost:3000",
  });
}

async function defaultPromptKey(): Promise<string> {
  return password({
    message: "Kanon API Key:",
    mask: "*",
  });
}

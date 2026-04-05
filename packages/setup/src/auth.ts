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
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === "[::1]" ||
      host === "0.0.0.0"
    );
  } catch {
    return false;
  }
}

/**
 * Auto-generate an API key by logging in with dev credentials.
 * Only works against localhost URLs — returns null for remote or on any error.
 */
export async function autoGenerateApiKey(
  apiUrl: string,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): Promise<string | null> {
  if (!isLocalhost(apiUrl)) {
    return null;
  }

  try {
    // Step 1: Login with dev credentials
    const loginResp = await fetchFn(`${apiUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "dev@kanon.io",
        password: "Password1!",
        workspaceId: "kanon-dev",
      }),
    });

    if (!loginResp.ok) return null;

    const loginData = (await loginResp.json()) as {
      accessToken?: string;
    };
    const accessToken = loginData.accessToken;
    if (!accessToken) return null;

    // Step 2: Generate API key
    const keyResp = await fetchFn(`${apiUrl}/api/auth/api-key`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!keyResp.ok) return null;

    const keyData = (await keyResp.json()) as { apiKey?: string };
    return keyData.apiKey ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve API URL and key with a 5-step cascade:
 *   1. CLI flags
 *   2. Environment variables
 *   3. Existing MCP config extraction
 *   4. Auto-generation (localhost only)
 *   5. Interactive prompt
 *
 * URL is resolved first (steps 1-5), then key (steps 1-5),
 * because auto-generating a key requires a resolved URL.
 */
export async function resolveAuth(
  options: { apiUrl?: string; apiKey?: string; yes?: boolean },
  ctx: PlatformContext,
  deps?: AuthDeps,
): Promise<AuthResult> {
  const _extractExisting = deps?.extractExisting ?? extractExistingAuth;
  const _autoGenerateKey = deps?.autoGenerateKey ?? autoGenerateApiKey;
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

  // Step 4: Auto-generate (localhost only)
  if (!apiKey) {
    const generated = await _autoGenerateKey(apiUrl);
    if (generated) {
      apiKey = generated;
      keySource = "auto-generated";
    }
  }

  // Step 5: Interactive prompt
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

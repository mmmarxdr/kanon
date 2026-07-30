/**
 * onboard.ts — Handle kanon:// onboarding links.
 *
 * Flow:
 *   1. Parse and validate the kanon:// URL
 *   2. POST /api/auth/onboard with the JWT token
 *   3. Validate the response (refreshToken, apiUrl, email, workspace)
 *   4. Write credentials to the credential store
 *   5. Install each detected tool's complete supported product surface
 */

import type { CredentialStore } from "./credential-store/index.js";
import { getCredentialStore } from "./credential-store/factory.js";
import { OnboardResponseSchema } from "./api-types.js";
import { buildPlatformContext } from "./detect.js";
import { detectTools } from "./registry.js";
import {
  buildWrapperMcpEntry,
  type McpResolution,
  resolveNodeBin,
  resolveWrapperPath,
} from "./mcp-config.js";
import { canonicalizeApiUrl } from "./canonical-url.js";
import { getAssetsDir, installToolSurface } from "./tool-surface.js";
import type { PlatformContext, ToolDefinition } from "./types.js";
import { selectTools } from "./tool-selection.js";

export interface OnboardedTool {
  /** Tool registry name (e.g. "claude-code", "cursor"). */
  name: string;
  /** Display name (e.g. "Claude Code"). */
  displayName: string;
  /** Paths to every config target updated for this user-facing tool. */
  configPaths: string[];
  /** Present when this tool failed without blocking the remaining selections. */
  error?: string;
}

export interface OnboardDeps {
  fetchFn?: typeof globalThis.fetch;
  credentialStore?: CredentialStore;
  /**
   * Detect installed AI tools and install every supported product surface.
   */
  installToolSurfaces?: (apiUrl: string, workspaceId: string) => Promise<OnboardedTool[]>;
  /** Stdout sink for progress messages (defaults to process.stdout). */
  stdout?: { write: (s: string) => void };
}

export async function installOnboardedTools(
  apiUrl: string,
  workspaceId: string,
  deps: {
    ctx?: PlatformContext;
    tools?: ToolDefinition[];
    assetsDir?: string;
    nodeBin?: string;
    wrapperResolution?: McpResolution;
    isInteractive?: boolean;
    promptTools?: (choices: Array<{ name: string; value: string; checked: boolean }>) => Promise<string[]>;
  } = {},
): Promise<OnboardedTool[]> {
  const ctx = deps.ctx ?? await buildPlatformContext();
  const detected = deps.tools ?? await detectTools(ctx);
  const tools = deps.tools ?? (
    detected.length === 0
      ? []
      : await selectTools(
          detected,
          {},
          deps.isInteractive ?? !!process.stdin.isTTY,
          ctx,
          { promptTools: deps.promptTools },
        )
  );
  const nodeBin = deps.nodeBin ?? resolveNodeBin();
  const assetsDir = deps.assetsDir ?? getAssetsDir();
  const wrapperResolution = deps.wrapperResolution ?? resolveWrapperPath();
  const written: OnboardedTool[] = [];

  for (const tool of tools) {
    try {
      const targets = installToolSurface({
        tool,
        ctx,
        assetsDir,
        buildEntry: (target) => buildWrapperMcpEntry(
          apiUrl,
          target.mcpMode,
          nodeBin,
          wrapperResolution,
          workspaceId,
          tool.clientIdentity,
        ),
      });

      written.push({
        name: tool.name,
        displayName: tool.displayName,
        configPaths: targets.map((target) => target.configPath),
      });
    } catch (err) {
      written.push({
        name: tool.name,
        displayName: tool.displayName,
        configPaths: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return written;
}

/**
 * Parse a kanon:// URL and return { apiUrl, token }.
 * Throws a formatted error if the URL is invalid.
 */
function parseOnboardLink(link: string): {
  apiUrl: string;
  token: string;
} {
  if (!link.startsWith("kanon://")) {
    throw { invalid: true };
  }

  let parsed: URL;
  try {
    // Replace kanon:// with https:// for URL parsing
    parsed = new URL(link.replace(/^kanon:\/\//, "https://"));
  } catch {
    throw { invalid: true };
  }

  const token = parsed.searchParams.get("token");
  if (!token || token.length < 10) {
    throw { invalid: true };
  }

  const host = parsed.hostname;
  const isLocalhost =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]";

  const scheme = isLocalhost ? "http" : "https";
  const portStr = parsed.port ? `:${parsed.port}` : "";
  const apiUrl = `${scheme}://${host}${portStr}`;

  return { apiUrl, token };
}

/**
 * Handle a kanon:// onboarding link.
 * Writes credentials and registers the MCP server entry.
 */
export async function onboardFromLink(
  link: string,
  deps: OnboardDeps = {},
): Promise<void> {
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const store = deps.credentialStore ?? getCredentialStore();

  // ── 1. Parse ──────────────────────────────────────────────────────────────
  let parsed: { apiUrl: string; token: string };
  try {
    parsed = parseOnboardLink(link);
  } catch {
    process.stderr.write(
      "Error: Invalid onboarding link format.\n" +
        "Expected: kanon://<server>/onboard?token=<token>\n",
    );
    process.exit(1);
  }

  const { apiUrl, token } = parsed!;

  // ── 2. POST /api/auth/onboard ─────────────────────────────────────────────
  let responseBody: unknown;
  try {
    const resp = await fetchFn(`${apiUrl}/api/auth/onboard`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });

    responseBody = await resp.json();

    if (!resp.ok) {
      const body = responseBody as { code?: string; message?: string };
      if (body.code === "TOKEN_EXPIRED") {
        process.stderr.write(
          "Error: Onboarding link has expired. Request a new invite from your workspace admin.\n",
        );
      } else if (body.code === "TOKEN_CONSUMED") {
        process.stderr.write(
          "Error: This onboarding link has already been used.\n" +
            "Each link can only be used once. Request a new invite from your workspace admin.\n",
        );
      } else {
        process.stderr.write(
          `Error: Onboarding failed (${resp.status}): ${body.message ?? "unknown error"}\n`,
        );
      }
      process.exit(1);
    }
  } catch (err) {
    // Only catch network errors — process.exit throws are re-thrown by design
    if (err instanceof Error && err.message === "process.exit") throw err;
    process.stderr.write(
      `Error: Network request failed — server unreachable at ${apiUrl}.\n` +
        `Details: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }

  // ── 3. Validate response ──────────────────────────────────────────────────
  const parsed2 = OnboardResponseSchema.safeParse(responseBody);
  if (!parsed2.success) {
    process.stderr.write(
      `Error: Unexpected response from server: ${parsed2.error.message}\n`,
    );
    process.exit(1);
  }
  const data = parsed2.data;

  // ── 4. Write credentials ──────────────────────────────────────────────────
  // Key the credential store by the CANONICAL API URL.
  // The MCP wrapper looks creds up by canonicalize(--server <url>), so both
  // writer (setup) and reader (mcp) must use the same canonical key to avoid drift.
  const canonApiUrl = canonicalizeApiUrl(data.apiUrl);
  try {
    await store.writeCredentials(canonApiUrl, {
      server: canonApiUrl,
      refreshToken: data.refreshToken,
      email: data.email,
      savedAt: new Date().toISOString(),
    });
  } catch (err) {
    process.stderr.write(
      `Error: Failed to save credentials — ${err instanceof Error ? err.message : String(err)}\n` +
        "Check file permissions for ~/.kanon/credentials\n",
    );
    process.exit(1);
  }

  // ── 5. Surface progress so the dev knows the call succeeded ──────────────
  const stdout = deps.stdout ?? process.stdout;
  stdout.write(`✓ Onboarded as ${data.email}\n`);
  stdout.write(`  Server: ${canonApiUrl}\n`);
  stdout.write(`  Credentials saved to ~/.kanon/credentials\n`);
  stdout.write("\n");

  // ── 6. Install the full surface for each detected tool ───────────────────
  const installToolSurfaces = deps.installToolSurfaces ?? installOnboardedTools;
  let registered: OnboardedTool[] = [];
  try {
    registered = await installToolSurfaces(canonApiUrl, data.workspace.id);
  } catch (err) {
    stdout.write(
      `⚠  Failed to configure AI tools: ${err instanceof Error ? err.message : String(err)}\n` +
        `   Credentials are saved — configure manually with: kanon-setup --tool <name>\n`,
    );
    throw err;
  }

  if (registered.length === 0) {
    stdout.write(
      "No supported AI tools detected on this machine.\n" +
        "Install Claude Code, Cursor, or Antigravity and re-run: kanon-setup --tool <name>\n",
    );
    return;
  }

  const configured = registered.filter((tool) => !tool.error);
  const failed = registered.filter((tool) => tool.error);

  if (configured.length > 0) {
    stdout.write(`✓ Configured ${configured.length} tool(s):\n`);
  }
  for (const tool of configured) {
    stdout.write(`  - ${tool.displayName} (${tool.configPaths.join(", ")})\n`);
  }
  for (const tool of failed) {
    stdout.write(`⚠  ${tool.displayName} was not configured: ${tool.error}\n`);
  }
  if (failed.length > 0) {
    throw new Error(`${failed.length} selected tool(s) could not be configured`);
  }
  stdout.write("\nRestart your AI coding tool(s) to pick up the new configuration.\n");
}

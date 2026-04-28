/**
 * onboard.ts — Handle kanon:// onboarding links.
 *
 * Flow:
 *   1. Parse and validate the kanon:// URL
 *   2. POST /api/auth/onboard with the JWT token
 *   3. Validate the response (refreshToken, apiUrl, email, workspace)
 *   4. Write credentials to the credential store
 *   5. Register the MCP entry in wrapper mode (no KANON_API_KEY)
 */

import type { CredentialStore } from "./credential-store/index.js";
import { getCredentialStore } from "./credential-store/factory.js";
import { OnboardResponseSchema } from "./api-types.js";
import type { McpServerEntry } from "./types.js";

export interface OnboardDeps {
  fetchFn?: typeof globalThis.fetch;
  credentialStore?: CredentialStore;
  /**
   * Injectable MCP entry writer. In production this calls mergeConfig().
   * In tests it's a vi.fn() that records invocations.
   */
  writeMcpEntry?: (opts: {
    apiUrl: string;
    mode: "wrapper";
    entry: McpServerEntry;
  }) => Promise<void>;
}

/**
 * Parse a kanon:// URL and return { host, apiUrl, token }.
 * Throws a formatted error if the URL is invalid.
 */
function parseOnboardLink(link: string): {
  host: string;
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

  return { host, apiUrl, token };
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
  let parsed: { host: string; apiUrl: string; token: string };
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
  // Key the credential store by the full API URL (scheme + host + port).
  // The MCP wrapper looks creds up by `--server <url>`, so writer and reader
  // must use the same canonical key.
  try {
    await store.writeCredentials(data.apiUrl, {
      server: data.apiUrl,
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

  // ── 5. Register MCP entry (wrapper mode) ─────────────────────────────────
  if (deps.writeMcpEntry) {
    // In tests / injected context: delegate to injected function
    await deps.writeMcpEntry({
      apiUrl: data.apiUrl,
      mode: "wrapper",
      entry: { command: process.execPath, args: ["--server", data.apiUrl] },
    });
  }
  // In production flow the caller (index.ts) handles MCP registration
  // after onboardFromLink returns successfully.
}

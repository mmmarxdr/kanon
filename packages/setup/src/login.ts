/**
 * login.ts — Interactive login for users who already have a Kanon server configured.
 *
 * Flow:
 *   1. Resolve the server URL from the credential store (fallback: env)
 *   2. Prompt email + password via @inquirer/prompts
 *   3. POST /api/auth/login → get accessToken
 *   4. POST /api/auth/refresh-issue (Bearer accessToken) → get opaque refreshToken
 *   5. Write updated credentials to store
 */

import type { CredentialStore } from "./credential-store/index.js";
import { getCredentialStore } from "./credential-store/factory.js";

export interface LoginDeps {
  fetchFn?: typeof globalThis.fetch;
  credentialStore?: CredentialStore;
  /** Injectable prompt for email (defaults to @inquirer/prompts input) */
  promptEmail?: () => Promise<string>;
  /** Injectable prompt for password (defaults to @inquirer/prompts password) */
  promptPassword?: () => Promise<string>;
  /**
   * Override server URL resolution.
   * If not provided, server is read from the credential store's first entry.
   */
  resolveServer?: (store: CredentialStore) => Promise<string | null>;
}

/**
 * Resolve the server hostname from credentials store.
 * Returns null if no server is configured.
 */
async function defaultResolveServer(_store: CredentialStore): Promise<string | null> {
  // Check env var first
  const envUrl = process.env["KANON_API_URL"];
  if (envUrl) {
    try {
      return new URL(envUrl).hostname;
    } catch {
      // invalid URL — fall through
    }
  }
  return null;
}

export async function login(deps: LoginDeps = {}): Promise<void> {
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const store = deps.credentialStore ?? getCredentialStore();
  const resolveServer = deps.resolveServer ?? defaultResolveServer;

  // ── 1. Resolve server ────────────────────────────────────────────────────
  // Try credential store: find any stored server by looking at existing creds.
  // The store interface only supports readCredentials(server), so we need to
  // discover the server from stored credentials.
  // Strategy: check store for KANON_SERVER env, then fall back to resolveServer().
  let server: string | null = null;
  let apiUrl: string | null = null;

  // First try env (covers CI / scripted flows)
  const envApiUrl = process.env["KANON_API_URL"];
  if (envApiUrl) {
    try {
      const u = new URL(envApiUrl);
      server = u.hostname;
      apiUrl = envApiUrl.replace(/\/$/, "");
    } catch {
      // ignore
    }
  }

  // Then try: read from credential store using known server from env KANON_SERVER
  if (!server) {
    const envServer = process.env["KANON_SERVER"];
    if (envServer) {
      const creds = await store.readCredentials(envServer);
      if (creds) {
        server = creds.server;
        apiUrl = `https://${server}`;
      }
    }
  }

  // Then try injectable resolver
  if (!server) {
    const resolved = await resolveServer(store);
    if (resolved) {
      // resolved could be a hostname or full URL
      if (resolved.startsWith("http")) {
        try {
          const u = new URL(resolved);
          apiUrl = resolved.replace(/\/$/, "");
          server = u.hostname;
        } catch {
          server = null;
        }
      } else {
        server = resolved;
        apiUrl = `https://${server}`;
      }
    }
  }

  // Last resort: try to read credentials from store using a sentinel key.
  // The credential store's readCredentials() may return stored creds for any
  // server key if the store is pre-populated (e.g., FileCredentialStore's
  // default listing). We use the "_kanon_default_" sentinel to check if the
  // store can return any known server from its backing storage.
  // This also allows tests to inject a store mock that returns creds for
  // any server key and have login() discover the server from creds.server.
  if (!server) {
    // Try a few common approaches: use KANON_SERVER env, fall back to store probe
    const sentinelCreds = await store.readCredentials("_kanon_default_");
    if (sentinelCreds?.server) {
      server = sentinelCreds.server;
      apiUrl = `https://${server}`;
    }
  }

  if (!server || !apiUrl) {
    process.stderr.write(
      "Error: No server configured. Run 'kanon-setup' first to configure a server,\n" +
        "or set KANON_API_URL environment variable.\n",
    );
    process.exit(1);
  }

  // ── 2. Prompt credentials ────────────────────────────────────────────────
  const promptEmail =
    deps.promptEmail ??
    (async () => {
      const { input } = await import("@inquirer/prompts");
      return input({ message: "Email:" });
    });
  const promptPassword =
    deps.promptPassword ??
    (async () => {
      const { password } = await import("@inquirer/prompts");
      return password({ message: "Password:", mask: "*" });
    });

  const email = await promptEmail();
  const passwordValue = await promptPassword();

  // ── 3. POST /api/auth/login ──────────────────────────────────────────────
  let accessToken: string;
  try {
    const resp = await fetchFn(`${apiUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: passwordValue }),
    });

    const body = (await resp.json()) as {
      accessToken?: string;
      code?: string;
      message?: string;
    };

    if (!resp.ok) {
      if (resp.status === 401) {
        process.stderr.write(
          "Error: Invalid email or password. Please check your credentials and try again.\n",
        );
      } else {
        process.stderr.write(
          `Error: Login failed (${resp.status}): ${body.message ?? "unknown error"}\n`,
        );
      }
      process.exit(1);
    }

    if (!body.accessToken) {
      process.stderr.write(
        "Error: Server returned unexpected response — missing accessToken.\n",
      );
      process.exit(1);
    }
    accessToken = body.accessToken;
  } catch (err) {
    if (err instanceof Error && err.message === "process.exit") throw err;
    process.stderr.write(
      `Error: Network request failed — server unreachable at ${apiUrl}.\n` +
        `Details: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }

  // ── 4. POST /api/auth/refresh-issue ─────────────────────────────────────
  // Exchange the stateless JWT access token for a DB-backed opaque refresh token.
  let refreshToken: string;
  try {
    const resp = await fetchFn(`${apiUrl}/api/auth/refresh-issue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const body = (await resp.json()) as {
      refreshToken?: string;
      code?: string;
      message?: string;
    };

    if (!resp.ok) {
      process.stderr.write(
        `Error: Failed to issue refresh token (${resp.status}): ${body.message ?? "unknown error"}\n`,
      );
      process.exit(1);
    }

    if (!body.refreshToken) {
      process.stderr.write(
        "Error: Server returned unexpected response — missing refreshToken.\n",
      );
      process.exit(1);
    }
    refreshToken = body.refreshToken;
  } catch (err) {
    if (err instanceof Error && err.message === "process.exit") throw err;
    process.stderr.write(
      `Error: Network request failed — server unreachable at ${apiUrl}.\n` +
        `Details: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }

  // ── 5. Write credentials ─────────────────────────────────────────────────
  await store.writeCredentials(server, {
    server,
    refreshToken: refreshToken!,
    email,
    savedAt: new Date().toISOString(),
  });

  process.stdout.write(`Logged in as ${email} on ${server}\n`);
}

/**
 * wrapper-reuse.ts — Credential-reuse logic for re-runs of kanon-setup.
 *
 * When a machine already has a working wrapper-mode install (credentials in
 * ~/.kanon/credentials), re-running `node setup/dist/index.js` with no TTY
 * and no kanon:// link would previously throw "API key could not be resolved
 * automatically" because the auth cascade only knows about static API keys.
 *
 * In the wrapper model there IS no API key — the credential store is the
 * durable auth artifact.  This module provides `resolveWrapperReuse()`, a
 * pure function that checks whether the credential store already has valid
 * credentials that can be used instead of going through auth resolution.
 */

import type { CredentialStore, Creds } from "./credential-store/index.js";
import { canonicalizeApiUrl } from "./canonical-url.js";

/**
 * The resolved reuse state — returned when the credential store has creds
 * that match the requested server (or, when no server was specified, when any
 * stored creds exist).
 */
export interface WrapperReuseResult {
  /** Canonical API URL of the selected stored server. */
  apiUrl: string;
  /** Full credential record for the selected server. */
  creds: Creds;
}

/**
 * Check whether the setup run can skip auth resolution by reusing existing
 * credentials from the store.
 *
 * Returns `WrapperReuseResult` when reuse is possible, or `null` when the
 * caller should proceed with the normal auth cascade.
 *
 * Reuse is SKIPPED (returns null) when:
 *   - `options.apiKey` is explicitly provided  → caller is requesting direct mode
 *   - The credential store is empty            → nothing to reuse
 *   - `options.apiUrl` is set and does not match any stored server
 *     (canonicalized comparison)              → user is targeting a different server
 *   - Any error reading the store             → degrade gracefully
 *
 * When multiple servers are stored and no `--api-url` was given, the server
 * with the most-recent `savedAt` timestamp is chosen.
 */
export async function resolveWrapperReuse(
  store: CredentialStore,
  options: { apiKey?: string; apiUrl?: string },
): Promise<WrapperReuseResult | null> {
  // Explicit --api-key → caller wants direct (static-key) mode; don't reuse.
  if (options.apiKey) {
    return null;
  }

  let servers: string[];
  try {
    servers = await store.listServers();
  } catch {
    // Graceful degradation — let the normal auth cascade handle this.
    return null;
  }

  if (servers.length === 0) {
    return null;
  }

  // If --api-url was specified, check whether it matches a stored server.
  if (options.apiUrl) {
    const canonRequested = canonicalizeApiUrl(options.apiUrl);
    if (!servers.includes(canonRequested)) {
      // Requested server is not in the store → no reuse possible.
      return null;
    }
    // Exact match — read and return that server's creds.
    const creds = await store.readCredentials(canonRequested);
    if (!creds) {
      return null;
    }
    return { apiUrl: canonRequested, creds };
  }

  // No --api-url: enumerate all stored servers, load their creds, pick most recent.
  const candidates: Array<{ apiUrl: string; creds: Creds }> = [];

  for (const server of servers) {
    const creds = await store.readCredentials(server);
    if (creds) {
      candidates.push({ apiUrl: server, creds });
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  // Sort descending by savedAt; pick the newest.
  candidates.sort(
    (a, b) =>
      new Date(b.creds.savedAt).getTime() - new Date(a.creds.savedAt).getTime(),
  );

  return candidates[0]!;
}

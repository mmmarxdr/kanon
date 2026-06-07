// ─── MCP Client Identity Validation (S1 review fix / KAN-30) ────────────────
//
// Resolves and validates the KANON_CLIENT_IDENTITY env variable at MCP startup.
// Unknown values are rejected with a stderr warning and treated as absent so
// no silently-null provenance can propagate to the API.

/**
 * Closed vocabulary of accepted client identity values.
 * Must stay in sync with packages/api/src/shared/via.ts VIA constant.
 */
export const VALID_IDENTITIES = [
  "claude-code",
  "cursor",
  "antigravity",
  "web",
  "cli",
] as const;

export type ClientIdentity = (typeof VALID_IDENTITIES)[number];

/**
 * Normalize and validate a raw KANON_CLIENT_IDENTITY value.
 *
 * - Absent / empty → returns null without logging (caller simply omits the header).
 * - Present but invalid → logs a clear warning to stderr and returns null
 *   (avoids silently-null provenance in API activity logs).
 * - Present and valid → returns the normalized (trimmed, lowercased) value.
 */
export function resolveClientIdentity(raw: string | undefined): string | null {
  if (!raw) return null;

  const normalized = raw.trim().toLowerCase();
  if (!normalized) return null;

  if ((VALID_IDENTITIES as readonly string[]).includes(normalized)) {
    return normalized;
  }

  // Invalid value — warn loudly and refuse to forward the header
  process.stderr.write(
    `[kanon-mcp] KANON_CLIENT_IDENTITY="${raw}" is invalid. ` +
      `Accepted values: ${VALID_IDENTITIES.join(", ")}. ` +
      `The X-Kanon-Client header will NOT be sent.\n`,
  );

  return null;
}

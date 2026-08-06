// ─── Via normalization (S1 / KAN-30) ─────────────────────────────────────────
//
// Closed vocabulary of known client identities.
// Value is read from the X-Kanon-Client request header and normalized here.
// Unknown or absent values resolve to null.

/**
 * Closed vocabulary of accepted X-Kanon-Client values.
 *
 * NOTE: "mcp" is deliberately NOT in this list.
 * "mcp" is a transport name (Model Context Protocol), not a client identity.
 * Clients running over MCP identify themselves via KANON_CLIENT_IDENTITY
 * (e.g. 'claude-code', 'cursor', 'codex'). normalizeVia('mcp') therefore returns null.
 */
export const VIA = ["claude-code", "cursor", "codex", "antigravity", "web", "cli"] as const;

export type Via = (typeof VIA)[number];

/**
 * Normalize a raw X-Kanon-Client header value against the closed vocabulary.
 * Returns the value if it is known, or null for unknown / absent values.
 */
export function normalizeVia(value?: string): string | null {
  if (!value) return null;
  if ((VIA as readonly string[]).includes(value)) return value;
  return null;
}

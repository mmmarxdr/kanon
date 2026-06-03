// ─── binding-resolver — pure projectKey resolution ───────────────────────────
//
// Merges an explicit tool-call argument with the .kanon walk-up binding.
// Explicit always wins; binding is the fallback; absent both → typed error.
//
// This is a pure function with no side effects, kept separate from the MCP
// server layer so it can be unit-tested without mocking McpServer.

import type { KanonBinding } from "./kanon-binding.js";

// ─── Result type ─────────────────────────────────────────────────────────────

export type ResolveResult =
  | { ok: true; projectKey: string }
  | { ok: false; error: string };

// ─── Pure resolver ───────────────────────────────────────────────────────────

/**
 * Resolve the projectKey for a tool call.
 *
 * Priority:
 *   1. `explicit` — value passed directly as a tool argument (truthy string wins)
 *   2. `binding.projectKey` — resolved from the nearest `.kanon` file (walk-up)
 *   3. Error — neither source available
 *
 * @param explicit  The `projectKey` argument from the tool input (may be
 *                  undefined, null, or empty string when omitted by caller).
 * @param binding   The KanonBinding resolved at MCP startup, or null when no
 *                  `.kanon` file was found in the cwd walk-up.
 */
export function resolveProjectKey(
  explicit: string | undefined | null,
  binding: KanonBinding | null,
): ResolveResult {
  // Explicit non-empty string always wins.
  if (explicit) {
    return { ok: true, projectKey: explicit };
  }

  // Fall back to .kanon binding.
  if (binding?.projectKey) {
    return { ok: true, projectKey: binding.projectKey };
  }

  // No source available — return a clear, actionable error.
  return {
    ok: false,
    error:
      "No projectKey provided and no .kanon file found in the current directory tree. " +
      "Either pass projectKey explicitly on the tool call, or add a .kanon file to " +
      "the repository root with { \"projectKey\": \"...\", \"workspaceId\": \"...\", \"apiUrl\": \"...\" }.",
  };
}

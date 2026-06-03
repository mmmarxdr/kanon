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

// ─── Invalid binding sentinel ─────────────────────────────────────────────────
//
// When index.ts loads a .kanon file that exists but fails Zod/JSON parsing, it
// captures the error message and passes this shape instead of null. This lets
// the resolver distinguish "not found" from "found but invalid" — the two cases
// need different error messages surfaced to the LLM/user.

export interface InvalidBinding {
  invalid: string; // human-readable parse-error message
}

/** Type guard — narrows a binding value to the invalid-sentinel shape. */
export function isInvalidBinding(
  b: KanonBinding | InvalidBinding | null,
): b is InvalidBinding {
  return b !== null && "invalid" in b;
}

// ─── Pure resolver ───────────────────────────────────────────────────────────

/**
 * Resolve the projectKey for a tool call.
 *
 * Priority:
 *   1. `explicit` — value passed directly as a tool argument (truthy string wins)
 *   2. `binding.projectKey` — resolved from the nearest `.kanon` file (walk-up)
 *   3. `binding.invalid` — .kanon was found but failed to parse → surface reason
 *   4. null — .kanon absent entirely → not-found guidance
 *
 * @param explicit  The `projectKey` argument from the tool input (may be
 *                  undefined, null, or empty string when omitted by caller).
 * @param binding   The KanonBinding resolved at MCP startup, an InvalidBinding
 *                  sentinel when the file was found but malformed, or null when
 *                  no `.kanon` file was found in the cwd walk-up.
 */
export function resolveProjectKey(
  explicit: string | undefined | null,
  binding: KanonBinding | InvalidBinding | null,
): ResolveResult {
  // Explicit non-empty string always wins — even over an invalid binding.
  if (explicit) {
    return { ok: true, projectKey: explicit };
  }

  // Found a valid .kanon binding — use its projectKey.
  if (binding && !isInvalidBinding(binding) && binding.projectKey) {
    return { ok: true, projectKey: binding.projectKey };
  }

  // .kanon was found but failed to parse — surface the reason clearly.
  if (isInvalidBinding(binding)) {
    return {
      ok: false,
      error:
        `Found a .kanon file but it is invalid: ${binding.invalid}. ` +
        "Fix the .kanon file in the repository root, or pass projectKey explicitly on the tool call.",
    };
  }

  // .kanon absent entirely — return a clear, actionable not-found error.
  return {
    ok: false,
    error:
      "No projectKey provided and no .kanon file found in the current directory tree. " +
      "Either pass projectKey explicitly on the tool call, or add a .kanon file to " +
      "the repository root with { \"projectKey\": \"...\", \"workspaceId\": \"...\", \"apiUrl\": \"...\" }.",
  };
}

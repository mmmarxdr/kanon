/**
 * Shared helpers for reading activity-log `details` JSON.
 *
 * Convention (KAN-41):
 *  - Writers persist state changes as `{ from, to }`.
 *  - Readers MUST use `readStateChange` to get `from`/`to` so the convention
 *    has a single source of truth.
 *  - Legacy rows (before KAN-41) may carry `{ oldValue, newValue }` instead.
 *    `readStateChange` falls back to those keys for backward-compatibility.
 */

/**
 * Extract `from` and `to` from an activity-log `details` object.
 *
 * Priority:
 *  1. `details.from` / `details.to`  (canonical — written by all current writers)
 *  2. `details.oldValue` / `details.newValue`  (legacy fallback)
 *
 * Returns `{}` (no keys) when `details` is null, non-object, or an array so
 * callers can safely destructure with defaults.
 */
export function readStateChange(details: unknown): { from?: unknown; to?: unknown } {
  if (details === null || typeof details !== "object" || Array.isArray(details)) {
    return {};
  }
  const d = details as Record<string, unknown>;

  const from = d["from"] !== undefined ? d["from"] : d["oldValue"];
  const to = d["to"] !== undefined ? d["to"] : d["newValue"];

  const out: { from?: unknown; to?: unknown } = {};
  if (from !== undefined) out.from = from;
  if (to !== undefined) out.to = to;
  return out;
}

/**
 * Returns `true` when an activity-log details object represents a transition
 * into the "done" state.
 *
 * This is the canonical replacement for any inline `(d as any).to === "done"`
 * checks (e.g. cycle/service.ts burnup + lead-time computations).
 */
export function isDoneTransition(details: unknown): boolean {
  return readStateChange(details).to === "done";
}

import { fetchApi } from "@/lib/api-client";

/**
 * Shared reconcile-time API surface used by both useTransitionMutation and
 * useGroupTransitionMutation (KAN-188). Kept as a small module rather than a
 * shared orchestration hook — the two hooks legitimately differ in the state
 * they hold (single reconcileState vs. per-issue blockedIssues array), but
 * the wire contract (endpoint, body shape, error code) must not drift.
 */

/** The error code the API returns on a 409 when captured time needs confirmation. */
export const RECONCILIATION_ERROR_CODE = "RECONCILIATION_REQUIRED";

/**
 * Coerce a value (string or number) from a 409 payload into a finite number,
 * or null if it can't be parsed as one. Guards against malformed/missing
 * payload fields from ever reaching the UI as `NaN` or `"undefined"`.
 */
export function toFiniteHours(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** POST /api/issues/:key/reconcile-time { confirmedTotalHours } */
export function reconcileTime(issueKey: string, confirmedTotalHours: number) {
  return fetchApi<void>(
    `/api/issues/${encodeURIComponent(issueKey)}/reconcile-time`,
    {
      method: "POST",
      body: JSON.stringify({ confirmedTotalHours: String(confirmedTotalHours) }),
    },
  );
}

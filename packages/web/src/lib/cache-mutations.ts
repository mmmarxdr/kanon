/**
 * Pure cache mutation helpers — no React imports, no mutation-hook imports.
 *
 * These functions are called from inside TanStack Query lifecycle callbacks
 * (onMutate, onError, onSettled) where a QueryClient instance is already
 * in scope. They exist to centralise "what gets invalidated / optimistically
 * updated when cycle membership changes" in one auditable place.
 */
import type { QueryClient } from "@tanstack/react-query";
import { cycleKeys, issueKeys } from "./query-keys";
import type { IssueDetail } from "@/types/issue";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Which screen context triggered the cycle-membership mutation.
 *
 * - "issue-detail": the issue-detail page is mounted; the issue cache is
 *   already updated synchronously by setIssueDetailCycle in onMutate, and
 *   no other key has an active subscriber on this screen. Invalidates NOTHING.
 * - "cycles-view": the cycles view is mounted; invalidates cycleKeys.detail(cycleId)
 *   so burnup/scopeEvents recompute server-side.
 * - "all": escape hatch for SSE handlers and future cross-screen surfaces;
 *   invalidates all 4 keys. Use deliberately — never as a default.
 */
export type CycleMembershipContext = "issue-detail" | "cycles-view" | "all";

export interface InvalidateAfterCycleMembershipArgs {
  cycleId: string;
  /** Pass empty string "" when called in batch mode (no single issue is the focus). */
  issueKey: string;
  projectKey: string;
  context: CycleMembershipContext;
}

// ---------------------------------------------------------------------------
// invalidateAfterCycleMembership
// ---------------------------------------------------------------------------

/**
 * Single source of truth for "what should be invalidated after a cycle
 * attach/detach?". Callers MUST pass a `context` so this helper can scope
 * invalidations to keys with active subscribers.
 *
 * Context map:
 *  - "issue-detail" → NOTHING (optimistic update via setIssueDetailCycle in
 *                     onMutate already wrote the new cycle synchronously;
 *                     no other subscribers on this screen).
 *  - "cycles-view"  → cycleKeys.detail(cycleId) ONLY (burnup recomputes server-side).
 *  - "all"          → issueKeys.detail, cycleKeys.detail,
 *                     cycleKeys.list, issueKeys.list  (4 calls — escape hatch).
 */
export function invalidateAfterCycleMembership(
  queryClient: QueryClient,
  args: InvalidateAfterCycleMembershipArgs,
): void {
  const { cycleId, issueKey, projectKey, context } = args;

  if (context === "issue-detail") {
    // No-op by design. The issue-detail cache is updated synchronously via
    // setIssueDetailCycle in onMutate. Invalidating issueKeys.detail here
    // would discard the optimistic write and trigger a wasteful refetch.
    return;
  }

  if (context === "cycles-view") {
    void queryClient.invalidateQueries({ queryKey: cycleKeys.detail(cycleId) });
    return;
  }

  // context === "all"
  void queryClient.invalidateQueries({ queryKey: issueKeys.detail(issueKey) });
  void queryClient.invalidateQueries({ queryKey: cycleKeys.detail(cycleId) });
  void queryClient.invalidateQueries({ queryKey: cycleKeys.list(projectKey) });
  void queryClient.invalidateQueries({ queryKey: issueKeys.list(projectKey) });
}

// ---------------------------------------------------------------------------
// setIssueDetailCycle
// ---------------------------------------------------------------------------

/**
 * Optimistically update the `cycle` field of an issue in the detail cache.
 *
 * Used in `onMutate` of attach/detach mutations to make the issue-detail page
 * reflect the new cycle without a round-trip on the happy path.
 *
 * The `cycle` parameter is typed as `IssueDetail["cycle"]` so any future
 * expansion of that shape is caught at compile time.
 *
 * @param cycle — Pass `null` to clear (detach). Pass `{ id, name }` to set.
 * @returns The previous IssueDetail value for rollback in `onError`, or
 *          undefined if no cache entry existed.
 */
export function setIssueDetailCycle(
  queryClient: QueryClient,
  issueKey: string,
  cycle: IssueDetail["cycle"],
): IssueDetail | undefined {
  const previous = queryClient.getQueryData<IssueDetail>(
    issueKeys.detail(issueKey),
  );

  if (previous !== undefined) {
    queryClient.setQueryData<IssueDetail>(issueKeys.detail(issueKey), {
      ...previous,
      cycle,
    });
  }

  return previous;
}

import type { Issue } from "@/types/issue";

/**
 * Aggregate issues from TanStack Query getQueriesData entries.
 *
 * Each entry is a [QueryKey, data] tuple where data may be:
 *   - Issue[]  — the normal case (flat list queries)
 *   - Issue    — a single issue object (detail query leaking into the scope; KAN-90)
 *   - null / undefined — query in-flight or errored
 *   - anything else  — future cache shapes, defensive against breakage
 *
 * Invariant: always returns a flat Issue[] and never throws.
 */
export function aggregateIssuesFromQueries(
  entries: [unknown, unknown][],
): Issue[] {
  const issues: Issue[] = [];
  for (const [, data] of entries) {
    if (Array.isArray(data)) {
      issues.push(...(data as Issue[]));
    }
    // Non-array values (single object, null, undefined) are intentionally skipped.
  }
  return issues;
}

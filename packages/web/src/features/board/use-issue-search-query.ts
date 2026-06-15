/**
 * useIssueSearchQuery — debounced React Query hook for palette server search.
 *
 * Signature: (projectKey: string | null, rawSearch: string, filters: IssueFilters)
 *
 * Behaviour:
 *  - enabled: projectKey is non-null
 *  - debounce: ~200ms on rawSearch changes (coalesces rapid keystrokes)
 *  - queryKey: issueKeys.search(projectKey, debouncedQ, filters)
 *  - fetch: fetchApiValidated with issueListSchema (Zod boundary)
 *  - placeholderData: keepPreviousData (no flicker between searches)
 *
 * The rawSearch is debounced internally; the queryKey uses the debounced value
 * so React Query only sends one request per debounced update.
 */

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { fetchApiValidated } from "@/lib/api-client";
import { issueKeys } from "@/lib/query-keys";
import { issueListSchema, type IssueFilters } from "@kanon/shared";
import { buildIssueSearchParams } from "@/features/board/build-issue-search-params";

const DEBOUNCE_MS = 200;

/**
 * Internal hook: debounces a value by `delay` ms.
 * Returns the settled value after the delay has elapsed without a change.
 */
function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

export function useIssueSearchQuery(
  projectKey: string | null,
  rawSearch: string,
  filters: IssueFilters,
) {
  const debouncedSearch = useDebounced(rawSearch, DEBOUNCE_MS);

  return useQuery({
    queryKey: issueKeys.search(projectKey ?? "", debouncedSearch, filters),
    queryFn: () => {
      // projectKey is guaranteed non-null when enabled is true
      const key = projectKey!;
      const params = buildIssueSearchParams(debouncedSearch, filters);
      const qs = params.toString();
      const url = `/api/projects/${encodeURIComponent(key)}/issues${qs ? `?${qs}` : ""}`;
      return fetchApiValidated(url, issueListSchema);
    },
    enabled: projectKey !== null,
    placeholderData: keepPreviousData,
  });
}

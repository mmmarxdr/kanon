/**
 * buildIssueSearchParams — pure function, no side effects.
 *
 * Converts a free-text query string and an IssueFilters object into
 * URLSearchParams using the snake_case wire names expected by the API.
 *
 * Mapping (camelCase → snake_case):
 *   q              → q
 *   filters.state  → state
 *   filters.type   → type
 *   filters.priority → priority
 *   filters.hasDocuments → has_documents ("true" only when true; OMIT otherwise)
 *   filters.documentKind → document_kind
 *
 * Falsy / undefined / empty values are OMITTED from the output.
 */

import type { IssueFilters } from "@kanon/shared";

export function buildIssueSearchParams(
  q: string,
  filters: IssueFilters,
): URLSearchParams {
  const params = new URLSearchParams();

  const trimmedQ = q.trim();
  if (trimmedQ) {
    params.set("q", trimmedQ);
  }

  if (filters.state) {
    params.set("state", filters.state);
  }

  if (filters.type) {
    params.set("type", filters.type);
  }

  if (filters.priority) {
    params.set("priority", filters.priority);
  }

  // hasDocuments: only send when explicitly true — OMIT for false/undefined
  if (filters.hasDocuments === true) {
    params.set("has_documents", "true");
  }

  // documentKind takes precedence — if set, hasDocuments is not sent
  // (even if both were set, document_kind is the more specific filter)
  if (filters.documentKind) {
    params.set("document_kind", filters.documentKind);
    // Remove has_documents if documentKind is present (precedence rule)
    params.delete("has_documents");
  }

  return params;
}

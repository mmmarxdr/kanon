import { createRoute } from "@tanstack/react-router";
import { authenticatedRoute } from "../_authenticated";
import { InboxView } from "@/features/inbox/inbox-view";

/**
 * validateSearch for the /inbox route.
 * Exported so tests can verify the parsing logic in isolation.
 *
 * `blocked` is accepted as an optional boolean param (passive — no rendering effect in this change).
 * Required by REQ-PALETTE-AI-002: "Find blockers" in the command palette navigates to
 * /inbox?blocked=true. When KAN-50 wires real MCP roundtrips, the filter will be applied.
 */
export function validateInboxSearch(search: Record<string, unknown>): {
  blocked?: boolean;
} {
  const blocked =
    search["blocked"] === "true"
      ? true
      : search["blocked"] === "false"
        ? false
        : undefined;
  return { blocked };
}

export const inboxRoute = createRoute({
  path: "/inbox",
  getParentRoute: () => authenticatedRoute,
  component: InboxView,
  validateSearch,
});

function validateSearch(search: Record<string, unknown>) {
  return validateInboxSearch(search);
}

import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { authenticatedRoute } from "../_authenticated";

export interface IssueRouteSearch {
  /** Optional return target so the back button knows where to go. */
  from?: string;
}

export const issueRoute = createRoute({
  path: "/issue/$key",
  getParentRoute: () => authenticatedRoute,
  component: lazyRouteComponent(() => import("./issue-page")),
  validateSearch: (search: Record<string, unknown>): IssueRouteSearch => {
    return {
      from: typeof search.from === "string" ? search.from : undefined,
    };
  },
});

export interface SubscribeButtonProps {
  isSubscribed: boolean;
  isSubscriptionPending: boolean;
  onToggle: () => void;
}

/**
 * Subscribe/Unsubscribe button — exported for isolated unit testing (KAN-38).
 * Renders "Subscribe", "Unsubscribe", or the in-flight "…" label.
 * Disabled and cursor:not-allowed while any subscription mutation is pending.
 */
export function SubscribeButton({
  isSubscribed,
  isSubscriptionPending,
  onToggle,
}: SubscribeButtonProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={isSubscriptionPending}
      aria-pressed={isSubscribed}
      style={{
        height: 26,
        padding: "0 8px",
        borderRadius: 4,
        border: "1px solid var(--line)",
        background: "var(--panel)",
        fontSize: 11.5,
        color: isSubscriptionPending ? "var(--ink-4)" : "var(--ink-2)",
        cursor: isSubscriptionPending ? "not-allowed" : "pointer",
        opacity: isSubscriptionPending ? 0.6 : 1,
      }}
    >
      {isSubscriptionPending ? "…" : isSubscribed ? "Unsubscribe" : "Subscribe"}
    </button>
  );
}

import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { authenticatedRoute } from "../_authenticated";
import { AgentThread } from "@/features/issue-detail/agent-thread";
import { CommentsHighlightView } from "@/features/issue-detail/comments-highlight-view";

export interface IssueRouteSearch {
  /** Optional return target so the back button knows where to go. */
  from?: string;
  /** When "mention", the right pane highlights the target comment. */
  highlight?: "mention";
  /** UUID of the comment to scroll to and highlight. Omitted for description mentions. */
  commentId?: string;
}

export const issueRoute = createRoute({
  path: "/issue/$key",
  getParentRoute: () => authenticatedRoute,
  component: lazyRouteComponent(() => import("./issue-page")),
  validateSearch: (search: Record<string, unknown>): IssueRouteSearch => ({
    from: typeof search.from === "string" ? search.from : undefined,
    highlight: search.highlight === "mention" ? "mention" : undefined,
    commentId: typeof search.commentId === "string" ? search.commentId : undefined,
  }),
});

const AGENT_SOURCES = new Set(["mcp", "engram_sync", "system", "adr"]);

/**
 * RightPaneContent — implements the 4-case behavior matrix (design §4.3, REQ-MENTION-010).
 *
 * | agentComments.length | highlight === "mention" && commentId | renders |
 * |---|---|---|
 * | > 0 | No  | AgentThread |
 * | > 0 | Yes | AgentThread (with highlight injected via prop) |
 * | 0   | No  | AgentThread (empty state) |
 * | 0   | Yes | CommentsHighlightView |
 *
 * Exported so it can be unit-tested independently from the router-integrated IssuePage.
 */
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

export interface RightPaneContentProps {
  comments: import("@/types/issue").Comment[];
  isCommentsLoading: boolean;
  highlight: "mention" | undefined;
  commentId: string | undefined;
}

export function RightPaneContent({
  comments,
  isCommentsLoading,
  highlight,
  commentId,
}: RightPaneContentProps) {
  const agentComments = comments.filter((c) => AGENT_SOURCES.has(c.source));

  const showCommentsInsteadOfThread =
    highlight === "mention" && commentId !== undefined && agentComments.length === 0;

  if (showCommentsInsteadOfThread) {
    return (
      <CommentsHighlightView
        comments={comments}
        highlightCommentId={commentId}
        data-testid="comments-list"
      />
    );
  }

  return (
    <div data-testid="agent-thread">
      <AgentThread
        comments={comments}
        isLoading={isCommentsLoading}
      />
    </div>
  );
}

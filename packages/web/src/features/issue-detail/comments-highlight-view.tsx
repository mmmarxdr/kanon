import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Comment } from "@/types/issue";

interface CommentsHighlightViewProps {
  comments: Comment[];
  highlightCommentId: string | undefined;
  "data-testid"?: string;
}

/**
 * CommentsHighlightView — read-only list of all issue comments with optional
 * highlight + autoscroll for a specific comment.
 *
 * When highlightCommentId is provided and matches a comment:
 * - Scrolls the matching element into view on mount (block: "center", behavior: "auto")
 * - Sets data-highlighted="true" on the element for 1000ms, then clears it
 *
 * If highlightCommentId doesn't match any comment: renders normally, no errors.
 *
 * REQ-MENTION-009, REQ-MENTION-010, design §4.3
 */
export function CommentsHighlightView({
  comments,
  highlightCommentId,
  "data-testid": testId = "comments-list",
}: CommentsHighlightViewProps) {
  const highlightRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!highlightCommentId || !highlightRef.current) return;

    const el = highlightRef.current;
    el.setAttribute("data-highlighted", "true");
    el.scrollIntoView({ block: "center", behavior: "auto" });

    const timer = setTimeout(() => {
      el.setAttribute("data-highlighted", "false");
    }, 1000);

    return () => clearTimeout(timer);
  }, [highlightCommentId]);

  return (
    <div data-testid={testId}>
      {comments.length === 0 ? (
        <div
          style={{
            fontSize: 12,
            color: "var(--ink-4)",
            fontStyle: "italic",
            padding: "8px 0",
          }}
        >
          No comments yet.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {comments.map((comment) => {
            const isHighlighted = comment.id === highlightCommentId;
            return (
              <CommentHighlightItem
                key={comment.id}
                comment={comment}
                isHighlighted={isHighlighted}
                ref={isHighlighted ? highlightRef : undefined}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

interface CommentHighlightItemProps {
  comment: Comment;
  isHighlighted: boolean;
  ref?: React.Ref<HTMLDivElement>;
}

function CommentHighlightItem({
  comment,
  isHighlighted,
  ref,
}: CommentHighlightItemProps) {
  return (
    <div
      ref={ref}
      data-comment-id={comment.id}
      style={{
        padding: "8px 10px",
        borderRadius: 6,
        border: "1px solid var(--line)",
        background: "var(--panel)",
        transition: "box-shadow 1s",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 4,
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 500, color: "var(--ink)" }}>
          {comment.author.username}
        </span>
        <span
          className="mono"
          style={{ fontSize: 10, color: "var(--ink-4)", marginLeft: "auto" }}
        >
          {formatRelative(comment.createdAt)}
        </span>
      </div>
      <div
        style={{
          fontSize: 12,
          color: "var(--ink-2)",
          lineHeight: 1.5,
        }}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{comment.body}</ReactMarkdown>
      </div>
    </div>
  );
}

function formatRelative(iso: string): string {
  try {
    const date = new Date(iso);
    const diffMs = Date.now() - date.getTime();
    const min = Math.floor(diffMs / 60_000);
    if (min < 1) return "just now";
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `${day}d ago`;
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

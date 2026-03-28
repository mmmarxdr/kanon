import { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Comment } from "@/types/issue";

interface CommentListProps {
  comments: Comment[];
  isLoading: boolean;
  onAddComment: (body: string) => void;
  isSubmitting: boolean;
}

/**
 * Comments tab content for the issue detail panel.
 *
 * Renders comments in chronological order with markdown body (react-markdown + remark-gfm).
 * Includes an add-comment form at the bottom (textarea + submit button).
 */
export function CommentList({
  comments,
  isLoading,
  onAddComment,
  isSubmitting,
}: CommentListProps) {
  const [draft, setDraft] = useState("");

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = draft.trim();
      if (!trimmed) return;
      onAddComment(trimmed);
      setDraft("");
    },
    [draft, onAddComment],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
        Loading comments...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Comment list */}
      {comments.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          No comments yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {comments.map((comment) => (
            <CommentItem key={comment.id} comment={comment} />
          ))}
        </ul>
      )}

      {/* Add comment form */}
      <form onSubmit={handleSubmit} className="flex flex-col gap-2 pt-2 border-t border-border">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a comment... (markdown supported)"
          rows={3}
          className="w-full rounded bg-secondary text-sm text-foreground
            border border-border px-3 py-2 outline-none resize-y
            focus:border-primary focus:ring-1 focus:ring-primary/30 placeholder:text-muted-foreground"
          aria-label="New comment"
        />
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={!draft.trim() || isSubmitting}
            className="rounded bg-primary text-primary-foreground px-3 py-1.5
              text-sm font-medium transition-colors
              hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? "Submitting..." : "Comment"}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Single comment                                                     */
/* ------------------------------------------------------------------ */

function CommentItem({ comment }: { comment: Comment }) {
  return (
    <li className="rounded-lg border border-border bg-card p-3">
      {/* Header: author + timestamp + source badge */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-medium text-foreground">
          {comment.author.username}
        </span>
        {comment.source === "agent" && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-medium">
            AI
          </span>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {formatRelativeTime(comment.createdAt)}
        </span>
      </div>

      {/* Markdown body */}
      <div className="text-sm text-foreground/80 leading-relaxed [&_p]:mb-2 [&_p:last-child]:mb-0 [&_pre]:bg-secondary [&_pre]:rounded [&_pre]:p-2 [&_pre]:text-xs [&_code]:bg-secondary [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:text-primary [&_a]:underline [&_table]:text-xs [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {comment.body}
        </ReactMarkdown>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatRelativeTime(iso: string): string {
  try {
    const date = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60_000);

    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 30) return `${diffDay}d ago`;
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

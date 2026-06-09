/**
 * C4.1 — CommentsHighlightView: scroll-to y data-highlighted="true" en el comment
 *         con id === commentId cuando highlightCommentId coincide.
 * C4.2 — CommentsHighlightView: highlightCommentId que no existe → no lanza error,
 *         ningún elemento tiene data-highlighted="true".
 *
 * Refs: REQ-MENTION-009 escenarios 1-2, design §4.3 highlight visual
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import type { Comment } from "@/types/issue";

// ─── Mock scrollIntoView ──────────────────────────────────────────────────────

const scrollIntoViewMock = vi.fn();

beforeEach(() => {
  scrollIntoViewMock.mockClear();
  Element.prototype.scrollIntoView = scrollIntoViewMock;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const makeComment = (id: string, body: string): Comment => ({
  id,
  body,
  source: "human",
  via: null,
  createdAt: "2026-05-01T10:00:00.000Z",
  updatedAt: "2026-05-01T10:00:00.000Z",
  author: { id: "u-alice", username: "alice" },
});

const COMMENTS: Comment[] = [
  makeComment("cmt-1", "First comment"),
  makeComment("cmt-42", "Second comment @bob"),
  makeComment("cmt-99", "Third comment"),
];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("CommentsHighlightView (C4)", () => {
  it("C4.1 — highlighted comment has data-highlighted='true' and scrollIntoView is called", async () => {
    const { CommentsHighlightView } = await import("../comments-highlight-view");
    const { container } = render(
      <CommentsHighlightView comments={COMMENTS} highlightCommentId="cmt-42" />
    );

    // The target comment should have data-highlighted="true"
    const highlighted = container.querySelector("[data-comment-id='cmt-42']");
    expect(highlighted).toBeTruthy();
    expect(highlighted?.getAttribute("data-highlighted")).toBe("true");

    // scrollIntoView should have been called
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    expect(scrollIntoViewMock).toHaveBeenCalledWith({
      block: "center",
      behavior: "auto",
    });
  });

  it("C4.2 — non-existent highlightCommentId → no error, no element has data-highlighted='true'", async () => {
    const { CommentsHighlightView } = await import("../comments-highlight-view");

    expect(() => {
      render(
        <CommentsHighlightView comments={COMMENTS} highlightCommentId="cmt-nonexistent" />
      );
    }).not.toThrow();

    // No element should have data-highlighted="true"
    const highlighted = document.querySelector("[data-highlighted='true']");
    expect(highlighted).toBeNull();

    // scrollIntoView should NOT have been called
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it("C4.3 — all comments are rendered with data-comment-id attributes", async () => {
    const { CommentsHighlightView } = await import("../comments-highlight-view");
    const { container } = render(
      <CommentsHighlightView comments={COMMENTS} highlightCommentId="cmt-42" />
    );

    // All 3 comments should be rendered with data-comment-id
    expect(container.querySelector("[data-comment-id='cmt-1']")).toBeTruthy();
    expect(container.querySelector("[data-comment-id='cmt-42']")).toBeTruthy();
    expect(container.querySelector("[data-comment-id='cmt-99']")).toBeTruthy();
  });
});

/**
 * C1.1 — MentionRow: renders mentionedByUsername, context, issueTitle visible in DOM.
 * C1.2 — Click calls navigate with { from: "inbox" } only (highlight/commentId removed — KAN-108).
 * C1.3 — Click when commentId=null → navigate with { from: "inbox" } (same — no commentId field).
 *
 * Refs: REQ-MENTION-008, KAN-33 frontend deletions, KAN-108 PR1
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockNavigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mentionWithCommentId = {
  id: "mention-1",
  issueKey: "T-42",
  issueTitle: "Fix login",
  mentionedByUsername: "alice",
  context: "@bob revisa esto",
  commentId: "cmt-1",
  createdAt: "2026-05-01T10:00:00.000Z",
};

const mentionWithNullCommentId = {
  id: "mention-2",
  issueKey: "T-99",
  issueTitle: "Update docs",
  mentionedByUsername: "charlie",
  context: "@diana mira el spec",
  commentId: null,
  createdAt: "2026-05-02T08:00:00.000Z",
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("MentionRow (C1)", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it("C1.1 — renders mentionedByUsername, context, issueTitle visible in the DOM", async () => {
    const { MentionRow } = await import("../mention-row");
    render(<MentionRow mention={mentionWithCommentId} />);

    expect(screen.getByText("alice")).toBeTruthy();
    expect(screen.getByText("@bob revisa esto")).toBeTruthy();
    expect(screen.getByText("Fix login")).toBeTruthy();
  });

  it("C1.2 — click navigates to issue with from:inbox only (highlight/commentId removed — KAN-108)", async () => {
    const { MentionRow } = await import("../mention-row");
    render(<MentionRow mention={mentionWithCommentId} />);

    const button = screen.getByRole("button");
    fireEvent.click(button);

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/issue/$key",
      params: { key: "T-42" },
      search: { from: "inbox" },
    });
    // highlight and commentId must NOT be present on the search object
    const callArgs = mockNavigate.mock.calls[0]?.[0];
    expect("highlight" in callArgs.search).toBe(false);
    expect("commentId" in callArgs.search).toBe(false);
  });

  it("C1.3 — click when commentId=null → navigate with from:inbox only (no commentId field)", async () => {
    const { MentionRow } = await import("../mention-row");
    render(<MentionRow mention={mentionWithNullCommentId} />);

    const button = screen.getByRole("button");
    fireEvent.click(button);

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    const callArgs = mockNavigate.mock.calls[0]?.[0];
    expect(callArgs).toBeDefined();
    expect(callArgs.to).toBe("/issue/$key");
    expect(callArgs.params.key).toBe("T-99");
    expect(callArgs.search.from).toBe("inbox");
    // highlight and commentId must NOT be present
    expect("highlight" in callArgs.search).toBe(false);
    expect("commentId" in callArgs.search).toBe(false);
  });
});

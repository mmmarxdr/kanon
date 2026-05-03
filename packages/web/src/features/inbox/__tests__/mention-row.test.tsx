/**
 * C1.1 — MentionRow: renders mentionedByUsername, context, issueTitle visible in DOM.
 * C1.2 — Click calls navigate with correct search params (with commentId).
 * C1.3 — Click when commentId=null → navigate WITHOUT commentId in search.
 *
 * Refs: REQ-MENTION-008 escenarios 1-3, design §4.2
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

  it("C1.2 — click calls navigate with correct search params including commentId", async () => {
    const { MentionRow } = await import("../mention-row");
    render(<MentionRow mention={mentionWithCommentId} />);

    const button = screen.getByRole("button");
    fireEvent.click(button);

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/issue/$key",
      params: { key: "T-42" },
      search: { from: "inbox", highlight: "mention", commentId: "cmt-1" },
    });
  });

  it("C1.3 — click when commentId=null → navigate WITHOUT commentId in search", async () => {
    const { MentionRow } = await import("../mention-row");
    render(<MentionRow mention={mentionWithNullCommentId} />);

    const button = screen.getByRole("button");
    fireEvent.click(button);

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    const callArgs = mockNavigate.mock.calls[0][0];
    expect(callArgs.to).toBe("/issue/$key");
    expect(callArgs.params.key).toBe("T-99");
    expect(callArgs.search.from).toBe("inbox");
    expect(callArgs.search.highlight).toBe("mention");
    // commentId should NOT be present in search when null
    expect("commentId" in callArgs.search).toBe(false);
  });
});

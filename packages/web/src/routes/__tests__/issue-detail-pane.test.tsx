/**
 * C4.3 — Issue detail behavior matrix row 4:
 *         AgentThread vacío + highlight=mention + commentId → right pane muestra
 *         data-testid="comments-list" en lugar de data-testid="agent-thread"
 * C4.4 — Behavior matrix row 2:
 *         AgentThread con mensajes + highlight=mention + commentId → right pane
 *         muestra AgentThread (data-testid="agent-thread")
 * C4.5 — Behavior matrix row 3:
 *         AgentThread vacío + sin highlight=mention → right pane muestra AgentThread
 *         (comportamiento actual)
 *
 * Refs: REQ-MENTION-010 escenarios 1-3, design §4.3 behavior matrix
 *
 * NOTE: IssuePage is heavily router-integrated (issueRoute.useParams, useSearch,
 * useNavigate). We test the behavior matrix logic by testing the RightPaneContent
 * component which encapsulates the switching logic. This keeps the tests fast
 * and isolated from the router.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Comment } from "@/types/issue";

// ─── Mock scrollIntoView ──────────────────────────────────────────────────────

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.clearAllMocks();
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const makeComment = (id: string, source: Comment["source"], body = "hello"): Comment => ({
  id,
  body,
  source,
  createdAt: "2026-05-01T10:00:00.000Z",
  updatedAt: "2026-05-01T10:00:00.000Z",
  author: { id: "u-alice", username: "alice" },
});

const HUMAN_COMMENT = makeComment("cmt-human-1", "human", "Human comment");
const AGENT_COMMENT = makeComment("cmt-agent-1", "mcp", "Agent message");

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("RightPaneContent behavior matrix (C4)", () => {
  it("C4.3 — row 4: AgentThread empty + highlight=mention + commentId → shows comments-list, NOT agent-thread", async () => {
    const { RightPaneContent } = await import("../_authenticated/issue");

    render(
      <RightPaneContent
        comments={[HUMAN_COMMENT]}
        isCommentsLoading={false}
        highlight="mention"
        commentId="cmt-human-1"
      />
    );

    // comments-list should be present
    expect(screen.getByTestId("comments-list")).toBeTruthy();
    // agent-thread should NOT be present
    expect(screen.queryByTestId("agent-thread")).toBeNull();
  });

  it("C4.4 — row 2: AgentThread with messages + highlight=mention + commentId → shows agent-thread", async () => {
    const { RightPaneContent } = await import("../_authenticated/issue");

    render(
      <RightPaneContent
        comments={[HUMAN_COMMENT, AGENT_COMMENT]}
        isCommentsLoading={false}
        highlight="mention"
        commentId="cmt-human-1"
      />
    );

    // When there ARE agent comments, show AgentThread
    expect(screen.getByTestId("agent-thread")).toBeTruthy();
    // comments-list should NOT be present in this case
    expect(screen.queryByTestId("comments-list")).toBeNull();
  });

  it("C4.5 — row 3: AgentThread empty + no highlight=mention → shows agent-thread (current behavior)", async () => {
    const { RightPaneContent } = await import("../_authenticated/issue");

    render(
      <RightPaneContent
        comments={[HUMAN_COMMENT]}
        isCommentsLoading={false}
        highlight={undefined}
        commentId={undefined}
      />
    );

    // Without highlight=mention, always show AgentThread
    expect(screen.getByTestId("agent-thread")).toBeTruthy();
    expect(screen.queryByTestId("comments-list")).toBeNull();
  });

  it("C4.6 — row 1: AgentThread with messages + no highlight → shows agent-thread (unchanged behavior)", async () => {
    const { RightPaneContent } = await import("../_authenticated/issue");

    render(
      <RightPaneContent
        comments={[HUMAN_COMMENT, AGENT_COMMENT]}
        isCommentsLoading={false}
        highlight={undefined}
        commentId={undefined}
      />
    );

    expect(screen.getByTestId("agent-thread")).toBeTruthy();
    expect(screen.queryByTestId("comments-list")).toBeNull();
  });
});

/**
 * KAN-107 — Design Records tab: collapsed card list
 *
 * Verifies:
 *  DL-1: Loading state renders the loading message.
 *  DL-2: Empty state renders the empty message (no cards).
 *  DL-3: Cards render collapsed — kind badge + title + author/date visible,
 *         NO markdown body rendered.
 *  DL-4: Clicking a card navigates to /issue/:key/doc/:docId.
 *  DL-5: Multiple documents each render a card.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { IssueDocument } from "@/types/issue";

// ─── hoisted mocks ────────────────────────────────────────────────────────────

const { mockNavigate } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const makeDoc = (overrides: Partial<IssueDocument> = {}): IssueDocument => ({
  id: "doc-1",
  kind: "adr",
  title: "Database selection decision",
  body: "## Context\nWe evaluated several storage engines.\n\n## Decision\nChose the relational option.",
  createdAt: "2026-01-15T10:00:00.000Z",
  updatedAt: "2026-01-15T10:00:00.000Z",
  issueId: "issue-1",
  author: { id: "u-alice", username: "alice" },
  ...overrides,
});

const ISSUE_KEY = "KAN-42";

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("DocumentList (KAN-107)", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
  });

  it("DL-1: shows loading indicator when isLoading=true", async () => {
    const { DocumentList } = await import(
      "@/features/issue-detail/document-list"
    );

    render(
      <DocumentList documents={[]} isLoading={true} issueKey={ISSUE_KEY} />,
    );

    expect(screen.getByText(/loading design records/i)).toBeTruthy();
    expect(screen.queryByTestId("document-card")).toBeNull();
  });

  it("DL-2: shows empty state when documents list is empty", async () => {
    const { DocumentList } = await import(
      "@/features/issue-detail/document-list"
    );

    render(
      <DocumentList documents={[]} isLoading={false} issueKey={ISSUE_KEY} />,
    );

    expect(screen.getByText(/no design records yet/i)).toBeTruthy();
    expect(screen.queryByTestId("document-card")).toBeNull();
  });

  it("DL-3: card renders kind badge + title + author, NOT the markdown body", async () => {
    const { DocumentList } = await import(
      "@/features/issue-detail/document-list"
    );
    const doc = makeDoc();

    render(
      <DocumentList
        documents={[doc]}
        isLoading={false}
        issueKey={ISSUE_KEY}
      />,
    );

    // Kind badge must be present
    expect(screen.getByTestId("kind-badge-adr")).toBeTruthy();
    expect(screen.getByTestId("kind-badge-adr").textContent).toBe("ADR");

    // Title must be present
    expect(screen.getByText("Database selection decision")).toBeTruthy();

    // Author must be present
    expect(screen.getByText(/alice/)).toBeTruthy();

    // Body text must NOT appear in collapsed view
    expect(screen.queryByText(/We evaluated several storage engines/)).toBeNull();
    expect(screen.queryByText(/Chose the relational option/)).toBeNull();
  });

  it("DL-4: clicking a card navigates to /issue/:key/doc/:docId", async () => {
    const { DocumentList } = await import(
      "@/features/issue-detail/document-list"
    );
    const doc = makeDoc({ id: "doc-abc-123" });

    render(
      <DocumentList
        documents={[doc]}
        isLoading={false}
        issueKey={ISSUE_KEY}
      />,
    );

    const card = screen.getByTestId("document-card");
    fireEvent.click(card);

    expect(mockNavigate).toHaveBeenCalledOnce();
    const callArg = mockNavigate.mock.calls[0]?.[0] as { to: string; params: Record<string, string> };
    expect(callArg.to).toBe("/issue/$key/doc/$docId");
    expect(callArg.params).toEqual({ key: ISSUE_KEY, docId: "doc-abc-123" });
  });

  it("DL-5: multiple documents each render a card", async () => {
    const { DocumentList } = await import(
      "@/features/issue-detail/document-list"
    );
    const docs: IssueDocument[] = [
      makeDoc({ id: "doc-1", kind: "adr", title: "ADR One" }),
      makeDoc({ id: "doc-2", kind: "rfc", title: "RFC Two" }),
      makeDoc({ id: "doc-3", kind: "note", title: "Note Three" }),
    ];

    render(
      <DocumentList
        documents={docs}
        isLoading={false}
        issueKey={ISSUE_KEY}
      />,
    );

    const cards = screen.getAllByTestId("document-card");
    expect(cards).toHaveLength(3);

    expect(screen.getByText("ADR One")).toBeTruthy();
    expect(screen.getByText("RFC Two")).toBeTruthy();
    expect(screen.getByText("Note Three")).toBeTruthy();

    expect(screen.getByTestId("kind-badge-adr")).toBeTruthy();
    expect(screen.getByTestId("kind-badge-rfc")).toBeTruthy();
    expect(screen.getByTestId("kind-badge-note")).toBeTruthy();
  });

  it("DL-7: formatRelativeTime returns 'just now' for future dates (clock skew)", async () => {
    const { formatRelativeTime } = await import(
      "@/features/issue-detail/document-list"
    );

    // A date 10 minutes in the future (simulates clock skew)
    const future = new Date(Date.now() + 10 * 60_000).toISOString();
    expect(formatRelativeTime(future)).toBe("just now");
  });

  it("DL-6: pressing Enter on a card triggers navigation", async () => {
    const { DocumentList } = await import(
      "@/features/issue-detail/document-list"
    );
    const doc = makeDoc({ id: "doc-kbd-1" });

    render(
      <DocumentList
        documents={[doc]}
        isLoading={false}
        issueKey={ISSUE_KEY}
      />,
    );

    const card = screen.getByTestId("document-card");
    fireEvent.keyDown(card, { key: "Enter" });

    expect(mockNavigate).toHaveBeenCalledOnce();
  });
});

/**
 * KAN-107 / KAN-108 slice 4 — Design Records inline expand
 *
 * Verifies:
 *  DL-1: Loading state renders the loading message.
 *  DL-2: Empty state renders the empty message (no cards).
 *  DL-3: Cards render collapsed — kind badge + title + author/date visible,
 *         NO markdown body rendered.
 *  DL-4: Clicking a card navigates to /issue/:key/doc/:docId.
 *  DL-5: Multiple documents each render a card.
 *  DL-6: Pressing Enter on a card triggers navigation (keyboard a11y).
 *  DL-7: formatRelativeTime returns 'just now' for future dates (clock skew).
 *
 *  Inline expand tests (KAN-108 slice 4):
 *  DL-8:  Expand toggle shows body content + "Open full page" link on click.
 *  DL-9:  Collapse toggle hides body content after a second click.
 *  DL-10: Cards expand/collapse independently.
 *  DL-11: Cards are collapsed by default (body not in DOM initially).
 *  DL-12: "Open full page" link is present when expanded (not the card click).
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
    Link: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children?: React.ReactNode }) => (
      <a {...props}>{children}</a>
    ),
  };
});

// Mock Markdown to avoid react-markdown / mermaid complexity in unit tests.
// We only assert that the body text is passed through — not that Mermaid SVG renders.
vi.mock("@/components/ui/markdown", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown-body">{children}</div>
  ),
}));

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

describe("DocumentList (KAN-107 / KAN-108)", () => {
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

  it("DL-4: clicking the card header navigates to /issue/:key/doc/:docId", async () => {
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

  // ── Inline expand tests (KAN-108 slice 4) ───────────────────────────────────

  it("DL-11: card body is NOT rendered by default (collapsed)", async () => {
    const { DocumentList } = await import(
      "@/features/issue-detail/document-list"
    );
    const doc = makeDoc();

    render(
      <DocumentList documents={[doc]} isLoading={false} issueKey={ISSUE_KEY} />,
    );

    // No markdown body panel when collapsed
    expect(screen.queryByTestId("document-expand-panel")).toBeNull();
    expect(screen.queryByTestId("markdown-body")).toBeNull();
  });

  it("DL-8: expand toggle shows body content + 'Open full page' link", async () => {
    const { DocumentList } = await import(
      "@/features/issue-detail/document-list"
    );
    const doc = makeDoc({ id: "doc-expand-1" });

    render(
      <DocumentList documents={[doc]} isLoading={false} issueKey={ISSUE_KEY} />,
    );

    const expandBtn = screen.getByTestId("document-expand-toggle");
    fireEvent.click(expandBtn);

    // Body rendered
    expect(screen.getByTestId("document-expand-panel")).toBeTruthy();
    // Markdown mock renders the body text
    expect(screen.getByTestId("markdown-body")).toBeTruthy();
    expect(screen.getByTestId("markdown-body").textContent).toContain(
      "We evaluated several storage engines",
    );

    // "Open full page" link must be present
    const fullPageLink = screen.getByTestId("document-full-page-link");
    expect(fullPageLink).toBeTruthy();
  });

  it("DL-9: second click on expand toggle collapses body", async () => {
    const { DocumentList } = await import(
      "@/features/issue-detail/document-list"
    );
    const doc = makeDoc({ id: "doc-toggle-1" });

    render(
      <DocumentList documents={[doc]} isLoading={false} issueKey={ISSUE_KEY} />,
    );

    const expandBtn = screen.getByTestId("document-expand-toggle");

    // Expand
    fireEvent.click(expandBtn);
    expect(screen.getByTestId("document-expand-panel")).toBeTruthy();

    // Collapse
    fireEvent.click(expandBtn);
    expect(screen.queryByTestId("document-expand-panel")).toBeNull();
    expect(screen.queryByTestId("markdown-body")).toBeNull();
  });

  it("DL-10: multiple cards expand/collapse independently", async () => {
    const { DocumentList } = await import(
      "@/features/issue-detail/document-list"
    );
    const docs: IssueDocument[] = [
      makeDoc({ id: "doc-a", title: "ADR Alpha", body: "body alpha" }),
      makeDoc({ id: "doc-b", title: "ADR Beta", body: "body beta" }),
    ];

    render(
      <DocumentList documents={docs} isLoading={false} issueKey={ISSUE_KEY} />,
    );

    const toggles = screen.getAllByTestId("document-expand-toggle");
    expect(toggles).toHaveLength(2);

    // Expand only the second card
    fireEvent.click(toggles[1]!);

    const panels = screen.getAllByTestId("document-expand-panel");
    expect(panels).toHaveLength(1);

    // Only the second body appears
    const markdownBodies = screen.getAllByTestId("markdown-body");
    expect(markdownBodies).toHaveLength(1);
    expect(markdownBodies[0]!.textContent).toContain("body beta");
  });

  it("DL-12: 'Open full page' link is NOT present when card is collapsed", async () => {
    const { DocumentList } = await import(
      "@/features/issue-detail/document-list"
    );
    const doc = makeDoc({ id: "doc-no-link-1" });

    render(
      <DocumentList documents={[doc]} isLoading={false} issueKey={ISSUE_KEY} />,
    );

    // When collapsed, no full-page link
    expect(screen.queryByTestId("document-full-page-link")).toBeNull();
  });
});

  it("DL-13: keeps loading, error, empty, and data resources states distinct", async () => {
    const { DocumentList } = await import("@/features/issue-detail/document-list");
    const { rerender } = render(<DocumentList documents={[]} isLoading issueKey={ISSUE_KEY} />);
    expect(screen.getByText(/loading design records/i)).toBeInTheDocument();

    rerender(<DocumentList documents={[]} isLoading={false} isError error={new Error("Documents rejected")} issueKey={ISSUE_KEY} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/unable to load design records/i);
    expect(screen.queryByText(/no design records yet/i)).not.toBeInTheDocument();

    rerender(<DocumentList documents={[]} isLoading={false} issueKey={ISSUE_KEY} />);
    expect(screen.getByText(/no design records yet/i)).toBeInTheDocument();

    rerender(<DocumentList documents={[makeDoc()]} isLoading={false} issueKey={ISSUE_KEY} />);
    expect(screen.getByTestId("document-card")).toBeInTheDocument();
  });

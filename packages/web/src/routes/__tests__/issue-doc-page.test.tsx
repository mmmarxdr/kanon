/**
 * KAN-107 — Full-page document viewer: IssueDocPage
 *
 * Verifies:
 *  IDP-1: Document found — renders title, kind badge, author, and body.
 *  IDP-2: Document found — body is rendered via Markdown (no raw markdown syntax).
 *  IDP-3: Back link is present and navigates back to /issue/:key.
 *  IDP-4: Loading state renders the loading message.
 *  IDP-5: Document not found renders a "not found" message with back link.
 *
 * Strategy: issueDocRoute.useParams is spied upon (like in other route tests).
 * useIssueDocuments is mocked at the module level to return a fixture.
 * useNavigate is mocked similarly to issue-detail-pane.test.tsx.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { IssueDocument } from "@/types/issue";

// ─── hoisted mocks ────────────────────────────────────────────────────────────

const { mockNavigate, mockUseParams, mockUseIssueDocuments } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockUseParams: vi.fn(),
  mockUseIssueDocuments: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("@/features/issue-detail/use-issue-detail-queries", () => ({
  useIssueDocuments: mockUseIssueDocuments,
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ISSUE_KEY = "KAN-98";
const DOC_ID = "doc-adr-001";

const FIXTURE_DOC: IssueDocument = {
  id: DOC_ID,
  kind: "adr",
  title: "Canonical hours source and approval flow",
  body: "## Context\nWe need a canonical hours source.\n\n## Decision\nUse the API.",
  createdAt: "2026-01-20T09:00:00.000Z",
  updatedAt: "2026-01-20T09:00:00.000Z",
  issueId: "issue-98",
  author: { id: "u-bob", username: "bob" },
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("IssueDocPage (KAN-107)", () => {
  beforeEach(async () => {
    mockNavigate.mockReset();

    // Wire the route params spy for issueDocRoute
    const { issueDocRoute } = await import("../_authenticated/issue-doc");
    vi.spyOn(issueDocRoute, "useParams").mockReturnValue({
      key: ISSUE_KEY,
      docId: DOC_ID,
    });
  });

  it("IDP-4: shows loading message while documents are loading", async () => {
    mockUseIssueDocuments.mockReturnValue({ data: undefined, isLoading: true });

    const IssueDocPage = (await import("../_authenticated/issue-doc-page")).default;
    render(<IssueDocPage />);

    expect(screen.getByText(/loading document/i)).toBeTruthy();
  });

  it("IDP-1: renders document title, kind badge, author, and body when found", async () => {
    mockUseIssueDocuments.mockReturnValue({
      data: [FIXTURE_DOC],
      isLoading: false,
    });

    const IssueDocPage = (await import("../_authenticated/issue-doc-page")).default;
    render(<IssueDocPage />);

    // Title
    expect(screen.getByTestId("doc-title").textContent).toBe(
      "Canonical hours source and approval flow",
    );

    // Kind badge
    expect(screen.getByTestId("kind-badge-adr")).toBeTruthy();
    expect(screen.getByTestId("kind-badge-adr").textContent).toBe("ADR");

    // Author
    expect(screen.getByText(/bob/)).toBeTruthy();

    // Body container present
    expect(screen.getByTestId("doc-body")).toBeTruthy();
  });

  it("IDP-2: renders body content (markdown is processed, not raw)", async () => {
    mockUseIssueDocuments.mockReturnValue({
      data: [FIXTURE_DOC],
      isLoading: false,
    });

    const IssueDocPage = (await import("../_authenticated/issue-doc-page")).default;
    render(<IssueDocPage />);

    const body = screen.getByTestId("doc-body");

    // The heading text should appear (markdown rendered to DOM element)
    expect(body.textContent).toContain("Context");
    expect(body.textContent).toContain("Decision");

    // Raw markdown syntax (##) should NOT appear as literal text
    expect(body.textContent).not.toContain("##");
  });

  it("IDP-3: back link is present and navigates to /issue/:key", async () => {
    mockUseIssueDocuments.mockReturnValue({
      data: [FIXTURE_DOC],
      isLoading: false,
    });

    const IssueDocPage = (await import("../_authenticated/issue-doc-page")).default;
    render(<IssueDocPage />);

    const backLink = screen.getByTestId("back-link");
    expect(backLink).toBeTruthy();
    expect(backLink.textContent).toContain(ISSUE_KEY);

    fireEvent.click(backLink);

    expect(mockNavigate).toHaveBeenCalledOnce();
    const callArg = mockNavigate.mock.calls[0]?.[0] as { to: string; params: Record<string, string> };
    expect(callArg.to).toBe("/issue/$key");
    expect(callArg.params).toEqual({ key: ISSUE_KEY });
  });

  it("IDP-5: shows not-found message with back link when docId does not match", async () => {
    // Return documents that don't include the requested docId
    mockUseIssueDocuments.mockReturnValue({
      data: [{ ...FIXTURE_DOC, id: "doc-other-999" }],
      isLoading: false,
    });

    const IssueDocPage = (await import("../_authenticated/issue-doc-page")).default;
    render(<IssueDocPage />);

    expect(screen.getByText(/document not found/i)).toBeTruthy();

    // Back link should still be present
    const backLink = screen.getByTestId("back-link");
    expect(backLink).toBeTruthy();

    fireEvent.click(backLink);
    expect(mockNavigate).toHaveBeenCalledOnce();
  });
});

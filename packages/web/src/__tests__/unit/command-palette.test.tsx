/**
 * CommandPalette — KAN-111 PR2b test suite.
 *
 * KAN-90 regression intent preserved:
 *  - The palette no longer uses getQueriesData/aggregateIssuesFromQueries.
 *    The crash class is gone. Defensive handling is verified: palette handles
 *    empty/undefined server results without throwing.
 *
 * New scenarios (KAN-111):
 *  - Server results via useIssueSearchQuery render correctly
 *  - ADR / doc indicator shows when documentKinds is non-empty
 *  - No indicator shows when documentKinds is empty
 *  - Keyboard nav (↑↓ Enter Esc) works with server results
 *  - Actions section still renders and fires correctly
 *  - Empty state renders "No results"
 *  - Loading (pending) state renders without crashing
 *  - No-project fallback: projectKey null → issues hidden, actions work
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CommandPalette } from "@/components/command-palette";
import type { Issue } from "@/types/issue";

// --------------------------------------------------------------------------
// Module mocks — must be hoisted before any imports that touch the mocked modules
// --------------------------------------------------------------------------

const mockNavigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: "/board/KAN" }),
}));

vi.mock("@/hooks/use-workspace-query", () => ({
  useActiveWorkspaceId: () => "ws-1",
}));

vi.mock("@/hooks/use-projects-query", () => ({
  useProjectsQuery: () => ({ data: [] }),
}));

vi.mock("@/stores/command-palette-store", () => ({
  useCommandPaletteStore: (selector: (s: { mode: string }) => unknown) =>
    selector({ mode: "search" }),
}));

vi.mock("@/components/ui/icons", () => ({
  Icon: {
    Search: () => <span data-testid="icon-search" />,
    Spark: () => null,
    FileText: () => <span data-testid="icon-filetext" />,
  },
}));

vi.mock("@/components/ui/primitives", () => ({
  Kbd: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  StatePip: () => <span data-testid="state-pip" />,
  TypeGlyph: () => <span data-testid="type-glyph" />,
  FilterChipSelect: ({
    label,
    onChange,
  }: {
    label: string;
    value: string;
    options: { value: string; label: string }[];
    onChange: (v: string) => void;
  }) => (
    <button
      data-testid={`chip-${label.toLowerCase()}`}
      onClick={() => onChange("bug")}
    >
      {label}
    </button>
  ),
}));

// PaletteFilterBar — rendered as a simple stub so command-palette tests focus on palette logic
vi.mock("@/components/palette-filter-bar", () => ({
  PaletteFilterBar: ({
    raw: _raw,
    onRawChange: _onRawChange,
  }: {
    raw: string;
    onRawChange: (r: string) => void;
  }) => (
    <div data-testid="palette-filter-bar">
      <button
        data-testid="chip-state"
        onClick={() => _onRawChange("state:done")}
      >
        State
      </button>
      <button
        data-testid="chip-type"
        onClick={() => _onRawChange("type:bug")}
      >
        Type
      </button>
      <button
        data-testid="chip-priority"
        onClick={() => _onRawChange("priority:high")}
      >
        Priority
      </button>
    </div>
  ),
}));

// useActiveProjectKey — returns "KAN" by default
const mockUseActiveProjectKey = vi.fn<[], string | null>(() => "KAN");
vi.mock("@/hooks/use-active-project-key", () => ({
  useActiveProjectKey: () => mockUseActiveProjectKey(),
}));

// useIssueSearchQuery — fully controllable per test
const mockUseIssueSearchQuery = vi.fn();
vi.mock("@/features/board/use-issue-search-query", () => ({
  useIssueSearchQuery: (...args: unknown[]) => mockUseIssueSearchQuery(...args),
}));

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "i-1",
    key: "KAN-1",
    title: "Test issue",
    type: "task",
    priority: "medium",
    state: "todo",
    labels: [],
    projectId: "p-1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    documentKinds: [],
    ...overrides,
  };
}

function renderPalette(
  opts: { onClose?: () => void; onCreateIssue?: () => void } = {},
): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(
    <Wrapper>
      <CommandPalette
        onClose={opts.onClose ?? vi.fn()}
        onCreateIssue={opts.onCreateIssue ?? vi.fn()}
      />
    </Wrapper>,
  );
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("CommandPalette — server results (KAN-111)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseActiveProjectKey.mockReturnValue("KAN");
    mockUseIssueSearchQuery.mockReturnValue({ data: [], isPending: false });
  });

  // ── Render ─────────────────────────────────────────────────────────────

  it("renders the palette dialog", () => {
    renderPalette();
    expect(screen.getByTestId("command-palette")).toBeInTheDocument();
  });

  it("renders server results in the Issues section", () => {
    mockUseIssueSearchQuery.mockReturnValue({
      data: [
        makeIssue({ key: "KAN-5", title: "Auth module" }),
        makeIssue({ key: "KAN-6", title: "Billing flow" }),
      ],
      isPending: false,
    });

    renderPalette();

    expect(screen.getByText("Auth module")).toBeInTheDocument();
    expect(screen.getByText("Billing flow")).toBeInTheDocument();
  });

  it("does NOT show Issues section when query returns no results (actions still shown)", () => {
    mockUseIssueSearchQuery.mockReturnValue({ data: [], isPending: false });

    renderPalette();

    // Actions section is always present; Issues section heading only shows with results
    expect(screen.queryByText("Issues")).not.toBeInTheDocument();
    expect(screen.getByText(/go to board/i)).toBeInTheDocument();
  });

  it("renders without crashing when query is pending (loading state)", () => {
    mockUseIssueSearchQuery.mockReturnValue({ data: undefined, isPending: true });

    expect(() => renderPalette()).not.toThrow();
    expect(screen.getByTestId("command-palette")).toBeInTheDocument();
  });

  // ── KAN-90 regression: no crash on missing/undefined data ─────────────

  it("renders without crashing when data is undefined (network error / no cache)", () => {
    mockUseIssueSearchQuery.mockReturnValue({ data: undefined, isPending: false });

    expect(() => renderPalette()).not.toThrow();
    expect(screen.getByTestId("command-palette")).toBeInTheDocument();
  });

  // ── ADR / doc indicator ────────────────────────────────────────────────

  it("shows doc indicator when issue has documentKinds=['adr']", () => {
    mockUseIssueSearchQuery.mockReturnValue({
      data: [makeIssue({ key: "KAN-10", title: "Has ADR", documentKinds: ["adr"] })],
      isPending: false,
    });

    renderPalette();

    expect(screen.getByTestId("doc-indicator-KAN-10")).toBeInTheDocument();
  });

  it("shows 'ADR' label when documentKinds includes 'adr'", () => {
    mockUseIssueSearchQuery.mockReturnValue({
      data: [makeIssue({ key: "KAN-11", title: "ADR issue", documentKinds: ["adr"] })],
      isPending: false,
    });

    renderPalette();

    expect(screen.getByText("ADR")).toBeInTheDocument();
  });

  it("shows generic doc indicator when documentKinds has non-adr kind", () => {
    mockUseIssueSearchQuery.mockReturnValue({
      data: [makeIssue({ key: "KAN-12", title: "RFC issue", documentKinds: ["rfc"] })],
      isPending: false,
    });

    renderPalette();

    expect(screen.getByTestId("doc-indicator-KAN-12")).toBeInTheDocument();
  });

  it("shows no doc indicator when documentKinds is empty", () => {
    mockUseIssueSearchQuery.mockReturnValue({
      data: [makeIssue({ key: "KAN-13", title: "No docs", documentKinds: [] })],
      isPending: false,
    });

    renderPalette();

    expect(screen.queryByTestId("doc-indicator-KAN-13")).not.toBeInTheDocument();
  });

  it("shows no doc indicator when documentKinds is absent", () => {
    mockUseIssueSearchQuery.mockReturnValue({
      data: [
        makeIssue({ key: "KAN-14", title: "No kinds field", documentKinds: undefined }),
      ],
      isPending: false,
    });

    renderPalette();

    expect(screen.queryByTestId("doc-indicator-KAN-14")).not.toBeInTheDocument();
  });

  // ── No-project fallback ────────────────────────────────────────────────

  it("renders without crashing on no-project route", () => {
    mockUseActiveProjectKey.mockReturnValue(null);
    mockUseIssueSearchQuery.mockReturnValue({ data: undefined, isPending: false });

    expect(() => renderPalette()).not.toThrow();
    expect(screen.getByTestId("command-palette")).toBeInTheDocument();
  });

  it("still shows Actions section when projectKey is null", () => {
    mockUseActiveProjectKey.mockReturnValue(null);
    mockUseIssueSearchQuery.mockReturnValue({ data: undefined, isPending: false });

    renderPalette();

    expect(screen.getByText(/create new issue/i)).toBeInTheDocument();
  });

  it("does NOT show Issues section heading when there are no results", () => {
    mockUseActiveProjectKey.mockReturnValue(null);
    mockUseIssueSearchQuery.mockReturnValue({ data: undefined, isPending: false });

    renderPalette();

    // Section label uses uppercase transform in CSS, text content is "Issues"
    expect(screen.queryByText("Issues")).not.toBeInTheDocument();
  });

  // ── Keyboard navigation ────────────────────────────────────────────────

  it("keyboard nav (↓↑ Enter) does not crash", () => {
    mockUseIssueSearchQuery.mockReturnValue({
      data: [makeIssue({ key: "KAN-20", title: "Nav issue" })],
      isPending: false,
    });

    renderPalette();

    const dialog = screen.getByTestId("command-palette");
    expect(() => {
      fireEvent.keyDown(dialog, { key: "ArrowDown" });
      fireEvent.keyDown(dialog, { key: "ArrowUp" });
      fireEvent.keyDown(dialog, { key: "Enter" });
    }).not.toThrow();
  });

  it("Esc key calls onClose", () => {
    mockUseIssueSearchQuery.mockReturnValue({ data: [], isPending: false });
    const onClose = vi.fn();

    renderPalette({ onClose });

    const dialog = screen.getByTestId("command-palette");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  // ── Actions section ────────────────────────────────────────────────────

  it("renders the Actions section", () => {
    mockUseIssueSearchQuery.mockReturnValue({ data: [], isPending: false });

    renderPalette();

    expect(screen.getByText(/go to board/i)).toBeInTheDocument();
  });

  it("calls onCreateIssue when Create new issue is activated via Enter (no issues → first item)", () => {
    mockUseIssueSearchQuery.mockReturnValue({ data: [], isPending: false });
    const onCreateIssue = vi.fn();
    const onClose = vi.fn();

    renderPalette({ onClose, onCreateIssue });

    // With no server issues, "Create new issue" is at index 0
    const dialog = screen.getByTestId("command-palette");
    fireEvent.keyDown(dialog, { key: "Enter" });

    expect(onCreateIssue).toHaveBeenCalledOnce();
  });

  // ── Filter bar ─────────────────────────────────────────────────────────

  it("renders the filter bar (PaletteFilterBar stub present)", () => {
    mockUseIssueSearchQuery.mockReturnValue({ data: [], isPending: false });

    renderPalette();

    expect(screen.getByTestId("palette-filter-bar")).toBeInTheDocument();
  });

  it("renders filter chips in filter bar", () => {
    mockUseIssueSearchQuery.mockReturnValue({ data: [], isPending: false });

    renderPalette();

    expect(screen.getByTestId("chip-state")).toBeInTheDocument();
    expect(screen.getByTestId("chip-type")).toBeInTheDocument();
    expect(screen.getByTestId("chip-priority")).toBeInTheDocument();
  });
});

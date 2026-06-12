/**
 * Regression tests for KAN-90: command-palette crash when the query cache
 * contains non-array shapes under the `issueKeys.all` prefix.
 *
 * Root cause: `getQueriesData({ queryKey: issueKeys.all })` returns every
 * cached entry whose key starts with ["issues"], including:
 *   - issueKeys.detail(key)  → a single Issue object (not iterable)
 *   - issueKeys.groups(key)  → a grouped summary structure (not Issue[])
 *   - issueKeys.documents(key) / issueKeys.context(key) → other shapes
 *
 * `issues.push(...data)` then throws `TypeError: data is not iterable`
 * which bubbles up through the render and white-screens the route.
 *
 * Fix: scope the lookup to `issueKeys.lists()` (the ["issues","list"] prefix
 * that only matches flat paginated list caches) and add an Array.isArray
 * guard as belt-and-suspenders.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { issueKeys } from "@/lib/query-keys";
import type { Issue, IssueDetail } from "@/types/issue";
import { CommandPalette } from "@/components/command-palette";

// --------------------------------------------------------------------------
// Module mocks — keep the component renderable in jsdom
// --------------------------------------------------------------------------

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
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
    Search: () => null,
    Spark: () => null,
  },
}));

vi.mock("@/components/ui/primitives", () => ({
  Kbd: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  StatePip: () => null,
  TypeGlyph: () => null,
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
    ...overrides,
  };
}

function makeDetailIssue(key: string): IssueDetail {
  return {
    ...makeIssue({ key, id: `i-${key}` }),
    project: { id: "p-1", key: "KAN", name: "Kanon" },
  };
}

function renderPalette(queryClient: QueryClient) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return render(
    <Wrapper>
      <CommandPalette onClose={vi.fn()} onCreateIssue={vi.fn()} />
    </Wrapper>,
  );
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("CommandPalette — KAN-90 non-array cache shapes", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  it("renders without crashing when only list cache entries exist", () => {
    queryClient.setQueryData(issueKeys.list("KAN"), [makeIssue()]);

    expect(() => renderPalette(queryClient)).not.toThrow();
    expect(screen.getByTestId("command-palette")).toBeInTheDocument();
  });

  it("renders without crashing when a detail cache entry is present (the KAN-90 repro)", () => {
    // This is the exact condition that triggers the crash:
    // Open an issue detail → populates issueKeys.detail("KAN-1")
    // Then open the command palette → iterates cache → tries to spread a single Issue
    queryClient.setQueryData(issueKeys.detail("KAN-1"), makeDetailIssue("KAN-1"));

    expect(() => renderPalette(queryClient)).not.toThrow();
    expect(screen.getByTestId("command-palette")).toBeInTheDocument();
  });

  it("renders without crashing when a groups cache entry is present", () => {
    // issueKeys.groups(projectKey) → an array of GroupSummary, not Issue[]
    queryClient.setQueryData(issueKeys.groups("KAN"), [
      { groupKey: "g-1", count: 3, latestState: "todo", title: "Group", updatedAt: "" },
    ]);

    expect(() => renderPalette(queryClient)).not.toThrow();
    expect(screen.getByTestId("command-palette")).toBeInTheDocument();
  });

  it("renders without crashing when detail AND list entries coexist", () => {
    // Both shapes in cache at the same time — the scenario after normal use
    queryClient.setQueryData(issueKeys.list("KAN"), [makeIssue()]);
    queryClient.setQueryData(issueKeys.detail("KAN-1"), makeDetailIssue("KAN-1"));

    expect(() => renderPalette(queryClient)).not.toThrow();
    expect(screen.getByTestId("command-palette")).toBeInTheDocument();
  });

  it("surfaces list-cached issues in the palette results", () => {
    queryClient.setQueryData(issueKeys.list("KAN"), [
      makeIssue({ key: "KAN-5", title: "My important issue" }),
    ]);

    renderPalette(queryClient);

    expect(screen.getByText("My important issue")).toBeInTheDocument();
  });

  it("does not surface the detail-cached single issue as a result (no duplication)", () => {
    // detail cache should NOT be iterated as a list — only list caches should
    queryClient.setQueryData(issueKeys.detail("KAN-1"), makeDetailIssue("KAN-1"));

    renderPalette(queryClient);

    // The detail issue title must NOT appear because detail isn't a flat list
    expect(screen.queryByText("Test issue")).not.toBeInTheDocument();
  });
});

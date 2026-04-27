import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { IssueDetail } from "@/types/issue";
import type { Cycle } from "@/types/cycle";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("focus-trap-react", () => ({
  FocusTrap: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// Mock useCyclesQuery used inside MetadataSection
vi.mock("@/features/cycles/use-cycles-query", () => ({
  useCyclesQuery: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function makeIssue(overrides: Partial<IssueDetail> = {}): IssueDetail {
  return {
    id: "issue-1",
    key: "TEST-1",
    title: "Test issue",
    type: "task",
    priority: "medium",
    state: "todo",
    labels: [],
    projectId: "proj-1",
    project: { id: "proj-1", key: "TEST", name: "Test Project" },
    createdAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-04-01T00:00:00Z",
    cycle: null,
    ...overrides,
  };
}

function makeCycle(
  id: string,
  state: Cycle["state"],
  startDate: string,
  endDate: string,
  name: string,
): Cycle {
  return {
    id,
    name,
    goal: null,
    state,
    startDate,
    endDate,
    velocity: null,
    projectId: "proj-1",
    createdAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-04-01T00:00:00Z",
  };
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const PROJECT_KEY = "TEST";

async function renderMetadataSection({
  issue,
  cycles,
  onCycleChange = vi.fn(),
  onFieldChange = vi.fn(),
  onTransition = vi.fn(),
}: {
  issue: IssueDetail;
  cycles: Cycle[];
  onCycleChange?: ReturnType<typeof vi.fn>;
  onFieldChange?: ReturnType<typeof vi.fn>;
  onTransition?: ReturnType<typeof vi.fn>;
}) {
  const { useCyclesQuery } = await import("@/features/cycles/use-cycles-query");
  vi.mocked(useCyclesQuery).mockReturnValue({
    data: cycles,
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof useCyclesQuery>);

  const { MetadataSection } = await import("./metadata-section");
  const wrapper = createWrapper();
  render(
    <MetadataSection
      issue={issue}
      projectKey={PROJECT_KEY}
      onFieldChange={onFieldChange}
      onTransition={onTransition}
      onCycleChange={onCycleChange}
    />,
    { wrapper },
  );
  return { onCycleChange, onFieldChange, onTransition };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MetadataSection — Cycle dropdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sorts cycles: active first, then upcoming (asc startDate), then done (desc startDate)", async () => {
    const activeCycle = makeCycle("c-active", "active", "2026-04-01", "2026-04-14", "Sprint A");
    const upcoming1 = makeCycle("c-upcoming-1", "upcoming", "2026-04-20", "2026-05-03", "Sprint C");
    const upcoming2 = makeCycle("c-upcoming-2", "upcoming", "2026-04-15", "2026-04-28", "Sprint B");
    const done1 = makeCycle("c-done-1", "done", "2026-03-01", "2026-03-14", "Sprint Old");
    const done2 = makeCycle("c-done-2", "done", "2026-03-15", "2026-03-28", "Sprint Newer");

    const cycles = [upcoming1, done1, activeCycle, done2, upcoming2];
    const issue = makeIssue();

    await renderMetadataSection({ issue, cycles });

    const cycleSelect = screen.getByTestId("metadata-cycle-select");
    const options = Array.from(cycleSelect.querySelectorAll("option")).map(
      (o) => o.textContent,
    );

    // Unassigned is first
    expect(options[0]).toBe("Unassigned");
    // Active comes next
    expect(options[1]).toBe("Sprint A");
    // Upcoming sorted asc by startDate: B (Apr 15) before C (Apr 20)
    expect(options[2]).toBe("Sprint B");
    expect(options[3]).toBe("Sprint C");
    // Done sorted desc by startDate: Newer (Mar 15) before Old (Mar 1)
    expect(options[4]).toBe("Sprint Newer");
    expect(options[5]).toBe("Sprint Old");
  });

  it('selecting "Unassigned" while issue has cycle.id = "A" fires onCycleChange(null, "A")', async () => {
    const cycleA = makeCycle("cycle-a", "active", "2026-04-01", "2026-04-14", "Sprint A");
    const issue = makeIssue({ cycle: { id: "cycle-a", name: "Sprint A" } });
    const onCycleChange = vi.fn();

    await renderMetadataSection({ issue, cycles: [cycleA], onCycleChange });

    const cycleSelect = screen.getByTestId("metadata-cycle-select");
    fireEvent.change(cycleSelect, { target: { value: "" } });

    expect(onCycleChange).toHaveBeenCalledOnce();
    expect(onCycleChange).toHaveBeenCalledWith(null, "cycle-a");
  });

  it("selecting cycle B while issue has cycle.id = A fires onCycleChange(B_id, A_id)", async () => {
    const cycleA = makeCycle("cycle-a", "active", "2026-04-01", "2026-04-14", "Sprint A");
    const cycleB = makeCycle("cycle-b", "upcoming", "2026-04-15", "2026-04-28", "Sprint B");
    const issue = makeIssue({ cycle: { id: "cycle-a", name: "Sprint A" } });
    const onCycleChange = vi.fn();

    await renderMetadataSection({ issue, cycles: [cycleA, cycleB], onCycleChange });

    const cycleSelect = screen.getByTestId("metadata-cycle-select");
    fireEvent.change(cycleSelect, { target: { value: "cycle-b" } });

    expect(onCycleChange).toHaveBeenCalledOnce();
    expect(onCycleChange).toHaveBeenCalledWith("cycle-b", "cycle-a");
  });

  it("selecting cycle B while issue has no cycle fires onCycleChange(B_id, null)", async () => {
    const cycleB = makeCycle("cycle-b", "upcoming", "2026-04-15", "2026-04-28", "Sprint B");
    const issue = makeIssue({ cycle: null });
    const onCycleChange = vi.fn();

    await renderMetadataSection({ issue, cycles: [cycleB], onCycleChange });

    const cycleSelect = screen.getByTestId("metadata-cycle-select");
    fireEvent.change(cycleSelect, { target: { value: "cycle-b" } });

    expect(onCycleChange).toHaveBeenCalledOnce();
    expect(onCycleChange).toHaveBeenCalledWith("cycle-b", null);
  });
});

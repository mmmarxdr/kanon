/**
 * KAN-105 PR3 — Unit tests for useUpsertPlanMutation.
 *
 * RED phase: written before implementation. Tests verify:
 *  - optimistic patch applies to scheduleTimelineKeys.project(projectKey) cache
 *  - rollback on error restores previous cache data
 *  - invalidation fires on settled (success and error paths)
 *  - toast on error
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { scheduleTimelineKeys } from "@/lib/query-keys";
import type { ScheduleTimelineRow } from "../use-project-schedule-timeline";

// ── Mocks ────────────────────────────────────────────────────────────────────

// Mock fetchApi so we control success/failure without a real server.
vi.mock("@/lib/api-client", () => ({
  fetchApi: vi.fn(),
}));

// Mock toast store — we only care it's called on error.
const addToastMock = vi.fn();
vi.mock("@/stores/toast-store", () => ({
  useToastStore: {
    getState: () => ({ addToast: addToastMock }),
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<ScheduleTimelineRow> = {}): ScheduleTimelineRow {
  return {
    issueId: "id-1",
    issueKey: "TST-1",
    title: "Test issue",
    state: "in_progress",
    type: "issue",
    startDate: "2026-03-01T00:00:00Z",
    dueDate: "2026-05-01T00:00:00Z",
    progress: 30,
    baselineStart: null,
    baselineEnd: null,
    forecastStart: null,
    forecastEnd: null,
    slipDays: null,
    critical: null,
    floatDays: null,
    deps: [],
    cycleId: null,
    cycleName: null,
    isNeighbor: false,
    ...overrides,
  };
}

const PROJECT_KEY = "TST";
const ISSUE_KEY = "TST-1";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useUpsertPlanMutation — optimistic update", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("optimistically patches startDate and dueDate in the timeline cache", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    // Never resolve — so we can inspect the optimistic update before settle
    vi.mocked(fetchApi).mockReturnValue(new Promise(() => {}));

    const { queryClient, wrapper } = createWrapper();

    // Pre-populate the cache with one row
    const initialData: ScheduleTimelineRow[] = [makeRow()];
    queryClient.setQueryData(scheduleTimelineKeys.project(PROJECT_KEY), initialData);

    const { useUpsertPlanMutation } = await import("../use-upsert-plan-mutation");
    const { result } = renderHook(() => useUpsertPlanMutation(), { wrapper });

    await act(async () => {
      result.current.mutate({
        issueKey: ISSUE_KEY,
        projectKey: PROJECT_KEY,
        startDate: "2026-04-01T00:00:00Z",
        dueDate: "2026-06-01T00:00:00Z",
      });
    });

    const cached = queryClient.getQueryData<ScheduleTimelineRow[]>(
      scheduleTimelineKeys.project(PROJECT_KEY),
    );
    const row = cached?.find((r) => r.issueKey === ISSUE_KEY);
    expect(row?.startDate).toBe("2026-04-01T00:00:00Z");
    expect(row?.dueDate).toBe("2026-06-01T00:00:00Z");
  });
});

describe("useUpsertPlanMutation — rollback on error", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rolls back the timeline cache when the mutation errors", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockRejectedValue(new Error("Server error"));

    const { queryClient, wrapper } = createWrapper();

    const originalRow = makeRow();
    queryClient.setQueryData(scheduleTimelineKeys.project(PROJECT_KEY), [originalRow]);

    const { useUpsertPlanMutation } = await import("../use-upsert-plan-mutation");
    const { result } = renderHook(() => useUpsertPlanMutation(), { wrapper });

    await act(async () => {
      result.current.mutate({
        issueKey: ISSUE_KEY,
        projectKey: PROJECT_KEY,
        startDate: "2026-04-01T00:00:00Z",
        dueDate: "2026-06-01T00:00:00Z",
      });
      // Give microtasks a chance to settle
      await Promise.resolve();
    });

    const cached = queryClient.getQueryData<ScheduleTimelineRow[]>(
      scheduleTimelineKeys.project(PROJECT_KEY),
    );
    const row = cached?.find((r) => r.issueKey === ISSUE_KEY);
    // Should be rolled back to original values
    expect(row?.startDate).toBe("2026-03-01T00:00:00Z");
    expect(row?.dueDate).toBe("2026-05-01T00:00:00Z");
  });

  it("shows an error toast when the mutation errors", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockRejectedValue(new Error("Server error"));

    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(scheduleTimelineKeys.project(PROJECT_KEY), [makeRow()]);

    const { useUpsertPlanMutation } = await import("../use-upsert-plan-mutation");
    const { result } = renderHook(() => useUpsertPlanMutation(), { wrapper });

    await act(async () => {
      result.current.mutate({
        issueKey: ISSUE_KEY,
        projectKey: PROJECT_KEY,
        startDate: "2026-04-01T00:00:00Z",
        dueDate: "2026-06-01T00:00:00Z",
      });
      await Promise.resolve();
    });

    expect(addToastMock).toHaveBeenCalledWith(
      expect.stringContaining(ISSUE_KEY),
      "error",
    );
  });
});

describe("useUpsertPlanMutation — invalidation on settled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("invalidates scheduleTimelineKeys.project on successful mutation", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockResolvedValue({ issueKey: ISSUE_KEY });

    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(scheduleTimelineKeys.project(PROJECT_KEY), [makeRow()]);

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { useUpsertPlanMutation } = await import("../use-upsert-plan-mutation");
    const { result } = renderHook(() => useUpsertPlanMutation(), { wrapper });

    await act(async () => {
      result.current.mutate({
        issueKey: ISSUE_KEY,
        projectKey: PROJECT_KEY,
        startDate: "2026-04-01T00:00:00Z",
        dueDate: "2026-06-01T00:00:00Z",
      });
      await Promise.resolve();
    });

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: scheduleTimelineKeys.project(PROJECT_KEY),
      }),
    );
  });

  it("invalidates scheduleTimelineKeys.project even when mutation errors", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockRejectedValue(new Error("Server error"));

    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(scheduleTimelineKeys.project(PROJECT_KEY), [makeRow()]);

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { useUpsertPlanMutation } = await import("../use-upsert-plan-mutation");
    const { result } = renderHook(() => useUpsertPlanMutation(), { wrapper });

    await act(async () => {
      result.current.mutate({
        issueKey: ISSUE_KEY,
        projectKey: PROJECT_KEY,
        startDate: "2026-04-01T00:00:00Z",
        dueDate: "2026-06-01T00:00:00Z",
      });
      await Promise.resolve();
    });

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: scheduleTimelineKeys.project(PROJECT_KEY),
      }),
    );
  });
});

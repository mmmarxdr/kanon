/**
 * Tests for useProjectScheduleTimeline hook (KAN-105 PR1).
 *
 * PSTL-1: returns parsed array when API responds 200.
 * PSTL-2: is disabled when projectKey is empty.
 * PSTL-3: calls fetchApiValidated with the correct URL.
 * PSTL-4: propagates non-404 errors as query errors.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/lib/api-client", () => ({
  fetchApi: vi.fn(),
  fetchApiValidated: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
    ) {
      super(message);
      this.name = "ApiError";
    }
  },
  ApiValidationError: class ApiValidationError extends Error {
    constructor(
      message: string,
      public override cause: unknown,
    ) {
      super(message);
      this.name = "ApiValidationError";
    }
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

const VALID_ROW = {
  issueId: "00000000-0000-0000-0000-000000000001",
  issueKey: "KAN-1",
  title: "Test issue",
  state: "backlog",
  type: "task",
  startDate: "2026-07-01T00:00:00.000Z",
  dueDate: "2026-07-31T00:00:00.000Z",
  progress: 0,
  baselineStart: null,
  baselineEnd: null,
  forecastStart: null,
  forecastEnd: null,
  slipDays: null,
  critical: null,
  floatDays: null,
  deps: [],
};

describe("useProjectScheduleTimeline (KAN-105 PR1)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("PSTL-1: returns parsed array when API responds 200", async () => {
    const { fetchApiValidated } = await import("@/lib/api-client");
    vi.mocked(fetchApiValidated).mockResolvedValue([VALID_ROW]);

    const { useProjectScheduleTimeline } = await import(
      "../use-project-schedule-timeline"
    );
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useProjectScheduleTimeline("KAN"),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0]?.issueKey).toBe("KAN-1");
    expect(result.current.data?.[0]?.slipDays).toBeNull();
  });

  it("PSTL-2: is disabled when projectKey is empty", async () => {
    const { fetchApiValidated } = await import("@/lib/api-client");

    const { useProjectScheduleTimeline } = await import(
      "../use-project-schedule-timeline"
    );
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useProjectScheduleTimeline(""),
      { wrapper },
    );

    expect(result.current.fetchStatus).toBe("idle");
    expect(vi.mocked(fetchApiValidated)).not.toHaveBeenCalled();
  });

  it("PSTL-3: calls fetchApiValidated with the correct URL", async () => {
    const { fetchApiValidated } = await import("@/lib/api-client");
    vi.mocked(fetchApiValidated).mockResolvedValue([]);

    const { useProjectScheduleTimeline } = await import(
      "../use-project-schedule-timeline"
    );
    const { wrapper } = createWrapper();
    renderHook(() => useProjectScheduleTimeline("MYPROJ"), { wrapper });

    await waitFor(() =>
      expect(vi.mocked(fetchApiValidated)).toHaveBeenCalled(),
    );

    const [url] = vi.mocked(fetchApiValidated).mock.calls[0]!;
    expect(url).toBe("/api/projects/MYPROJ/schedule-timeline");
  });

  it("PSTL-4: propagates non-404 errors as query errors", async () => {
    const { fetchApiValidated, ApiError } = await import("@/lib/api-client");
    const serverErr = new (ApiError as new (
      status: number,
      code: string,
      msg: string,
    ) => Error)(500, "INTERNAL_ERROR", "Server failure");
    vi.mocked(fetchApiValidated).mockRejectedValue(serverErr);

    const { useProjectScheduleTimeline } = await import(
      "../use-project-schedule-timeline"
    );
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useProjectScheduleTimeline("KAN"),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeDefined();
  });
});

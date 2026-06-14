/**
 * TDD tests for useIssueSchedule — real TanStack Query hook (KAN-98 / PR4).
 *
 * UIS-1: returns data parsed with issueScheduleSchema when API responds 200.
 * UIS-2: returns data: null when API responds 404 (issue has no schedule row yet).
 * UIS-3: is disabled when issueKey is an empty string.
 * UIS-4: calls fetchApiValidated with the correct schedule URL.
 * UIS-5: estimateHours is string | null (Decimal convention — never number).
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

const VALID_SCHEDULE = {
  issueId: "00000000-0000-0000-0000-000000000001",
  startDate: "2026-07-01T00:00:00.000Z",
  dueDate: "2026-07-31T00:00:00.000Z",
  progress: 42,
  estimateHours: "8.00",
  baselineStart: null,
  baselineEnd: null,
  baselineSetAt: null,
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-14T00:00:00.000Z",
};

describe("useIssueSchedule (PR4 — real query hook)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("UIS-1: returns parsed schedule data when API responds 200", async () => {
    const { fetchApiValidated } = await import("@/lib/api-client");
    vi.mocked(fetchApiValidated).mockResolvedValue(VALID_SCHEDULE);

    const { useIssueSchedule } = await import("../use-issue-schedule");
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useIssueSchedule("KAN-1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).not.toBeNull();
    expect(result.current.data?.progress).toBe(42);
    expect(result.current.data?.dueDate).toBe("2026-07-31T00:00:00.000Z");
  });

  it("UIS-2: returns data: null when API responds 404 (no schedule row)", async () => {
    const { fetchApiValidated, ApiError } = await import("@/lib/api-client");
    const notFound = new (ApiError as new (
      status: number,
      code: string,
      msg: string,
    ) => Error)(404, "SCHEDULE_NOT_FOUND", "No schedule");
    vi.mocked(fetchApiValidated).mockRejectedValue(notFound);

    const { useIssueSchedule } = await import("../use-issue-schedule");
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useIssueSchedule("KAN-2"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toBeNull();
  });

  it("UIS-3: is disabled when issueKey is empty", async () => {
    const { fetchApiValidated } = await import("@/lib/api-client");

    const { useIssueSchedule } = await import("../use-issue-schedule");
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useIssueSchedule(""), { wrapper });

    expect(result.current.fetchStatus).toBe("idle");
    expect(vi.mocked(fetchApiValidated)).not.toHaveBeenCalled();
  });

  it("UIS-4: calls fetchApiValidated with the correct schedule URL", async () => {
    const { fetchApiValidated } = await import("@/lib/api-client");
    vi.mocked(fetchApiValidated).mockResolvedValue(VALID_SCHEDULE);

    const { useIssueSchedule } = await import("../use-issue-schedule");
    const { wrapper } = createWrapper();
    renderHook(() => useIssueSchedule("KAN-99"), { wrapper });

    await waitFor(() =>
      expect(vi.mocked(fetchApiValidated)).toHaveBeenCalled(),
    );

    const [url] = vi.mocked(fetchApiValidated).mock.calls[0]!;
    expect(url).toBe("/api/issues/KAN-99/schedule");
  });

  it("UIS-5: estimateHours is string | null at boundary (Decimal convention)", async () => {
    const { fetchApiValidated } = await import("@/lib/api-client");
    vi.mocked(fetchApiValidated).mockResolvedValue(VALID_SCHEDULE);

    const { useIssueSchedule } = await import("../use-issue-schedule");
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useIssueSchedule("KAN-1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // estimateHours must be string, NOT number (Decimal convention)
    expect(typeof result.current.data?.estimateHours).toBe("string");
    expect(result.current.data?.estimateHours).toBe("8.00");
  });
});

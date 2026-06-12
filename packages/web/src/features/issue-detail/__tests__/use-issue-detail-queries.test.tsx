/**
 * TDD tests for useIssueDetailQuery — Zod boundary validation.
 *
 * Verifies that:
 *  - Valid IssueDetail response is returned with correct types
 *  - Malformed response surfaces ApiValidationError, not a downstream TypeError
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

// Valid IssueDetail fixture
const VALID_ISSUE_DETAIL = {
  id: "issue-1",
  key: "KAN-1",
  title: "Detailed issue",
  type: "feature" as const,
  priority: "high" as const,
  state: "in_progress" as const,
  labels: ["frontend"],
  projectId: "proj-1",
  project: { id: "proj-1", key: "KAN", name: "Kanon" },
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  cycle: null,
  subscribed: false,
};

describe("useIssueDetailQuery — Zod boundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns typed IssueDetail when response is valid", async () => {
    const { fetchApiValidated } = await import("@/lib/api-client");
    vi.mocked(fetchApiValidated).mockResolvedValue(VALID_ISSUE_DETAIL);

    const { useIssueDetailQuery } = await import(
      "@/features/issue-detail/use-issue-detail-queries"
    );
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useIssueDetailQuery("KAN-1"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.key).toBe("KAN-1");
    expect(result.current.data?.project.name).toBe("Kanon");
    expect(result.current.data?.cycle).toBeNull();
  });

  it("surfaces ApiValidationError when IssueDetail response is malformed", async () => {
    const { fetchApiValidated, ApiValidationError } =
      await import("@/lib/api-client");
    const validationErr = new (ApiValidationError as new (
      msg: string,
      cause: unknown,
    ) => Error)(
      "Response did not match schema for /api/issues/KAN-1",
      { issues: [{ path: ["project"], message: "Required" }] },
    );
    vi.mocked(fetchApiValidated).mockRejectedValue(validationErr);

    const { useIssueDetailQuery } = await import(
      "@/features/issue-detail/use-issue-detail-queries"
    );
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useIssueDetailQuery("KAN-1"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.constructor.name).toBe("ApiValidationError");
  });

  it("calls fetchApiValidated with the correct issue URL", async () => {
    const { fetchApiValidated } = await import("@/lib/api-client");
    vi.mocked(fetchApiValidated).mockResolvedValue(VALID_ISSUE_DETAIL);

    const { useIssueDetailQuery } = await import(
      "@/features/issue-detail/use-issue-detail-queries"
    );
    const { wrapper } = createWrapper();
    renderHook(() => useIssueDetailQuery("KAN-99"), { wrapper });

    await waitFor(() =>
      expect(vi.mocked(fetchApiValidated)).toHaveBeenCalled(),
    );

    const [url] = vi.mocked(fetchApiValidated).mock.calls[0]!;
    expect(url).toBe("/api/issues/KAN-99");
  });

  it("is disabled when issueKey is undefined", async () => {
    const { fetchApiValidated } = await import("@/lib/api-client");

    const { useIssueDetailQuery } = await import(
      "@/features/issue-detail/use-issue-detail-queries"
    );
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useIssueDetailQuery(undefined), {
      wrapper,
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(vi.mocked(fetchApiValidated)).not.toHaveBeenCalled();
  });
});

/**
 * TDD tests for useIssuesQuery, useGroupsQuery, useGroupIssuesQuery.
 *
 * These tests verify that:
 *  - The hooks surface ApiValidationError via query.error when the response
 *    doesn't match the schema
 *  - Valid responses return typed data
 *
 * Tests are written against the real hook implementations; they mock
 * fetchApiValidated (the new validated wrapper).
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Mock the entire api-client module so we can inject controlled responses
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

// Minimal valid issue fixture matching the Issue schema
const VALID_ISSUE = {
  id: "issue-1",
  key: "KAN-1",
  title: "Test issue",
  type: "task" as const,
  priority: "medium" as const,
  state: "todo" as const,
  labels: [],
  projectId: "proj-1",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const VALID_GROUP_SUMMARY = {
  groupKey: "group-a",
  count: 3,
  latestState: "in_progress" as const,
  title: "Group Alpha",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("useIssuesQuery — Zod boundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns typed Issue[] when response is valid", async () => {
    const { fetchApiValidated } = await import("@/lib/api-client");
    vi.mocked(fetchApiValidated).mockResolvedValue([VALID_ISSUE]);

    const { useIssuesQuery } = await import(
      "@/features/board/use-issues-query"
    );
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useIssuesQuery("KAN"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0]!.key).toBe("KAN-1");
  });

  it("surfaces ApiValidationError in query.error when response is malformed", async () => {
    const { fetchApiValidated, ApiValidationError } =
      await import("@/lib/api-client");
    const validationErr = new (ApiValidationError as new (
      msg: string,
      cause: unknown,
    ) => Error)("Response did not match schema for /api/issues", {
      issues: [{ path: ["title"], message: "Required" }],
    });
    vi.mocked(fetchApiValidated).mockRejectedValue(validationErr);

    const { useIssuesQuery } = await import(
      "@/features/board/use-issues-query"
    );
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useIssuesQuery("KAN"), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBeInstanceOf(ApiValidationError as never);
    // Must NOT be a raw TypeError
    expect(result.current.error?.constructor.name).toBe("ApiValidationError");
  });

  it("calls fetchApiValidated with the correct URL", async () => {
    const { fetchApiValidated } = await import("@/lib/api-client");
    vi.mocked(fetchApiValidated).mockResolvedValue([VALID_ISSUE]);

    const { useIssuesQuery } = await import(
      "@/features/board/use-issues-query"
    );
    const { wrapper } = createWrapper();
    renderHook(() => useIssuesQuery("KAN"), { wrapper });

    await waitFor(() =>
      expect(vi.mocked(fetchApiValidated)).toHaveBeenCalled(),
    );

    const [url] = vi.mocked(fetchApiValidated).mock.calls[0]!;
    expect(url).toBe(
      "/api/projects/KAN/issues?parent_only=true",
    );
  });
});

describe("useGroupsQuery — Zod boundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns typed GroupSummary[] when response is valid", async () => {
    const { fetchApiValidated } = await import("@/lib/api-client");
    vi.mocked(fetchApiValidated).mockResolvedValue([VALID_GROUP_SUMMARY]);

    const { useGroupsQuery } = await import(
      "@/features/board/use-issues-query"
    );
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useGroupsQuery("KAN"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data![0]!.groupKey).toBe("group-a");
    expect(result.current.data![0]!.count).toBe(3);
  });

  it("surfaces ApiValidationError when groups response is malformed", async () => {
    const { fetchApiValidated, ApiValidationError } =
      await import("@/lib/api-client");
    const validationErr = new (ApiValidationError as new (
      msg: string,
      cause: unknown,
    ) => Error)("Validation failed", { issues: [] });
    vi.mocked(fetchApiValidated).mockRejectedValue(validationErr);

    const { useGroupsQuery } = await import(
      "@/features/board/use-issues-query"
    );
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useGroupsQuery("KAN"), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.constructor.name).toBe("ApiValidationError");
  });
});

describe("useGroupIssuesQuery — Zod boundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns typed Issue[] when response is valid", async () => {
    const { fetchApiValidated } = await import("@/lib/api-client");
    vi.mocked(fetchApiValidated).mockResolvedValue([VALID_ISSUE]);

    const { useGroupIssuesQuery } = await import(
      "@/features/board/use-issues-query"
    );
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useGroupIssuesQuery("KAN", "group-a"),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data![0]!.key).toBe("KAN-1");
  });

  it("calls fetchApiValidated with correct group URL", async () => {
    const { fetchApiValidated } = await import("@/lib/api-client");
    vi.mocked(fetchApiValidated).mockResolvedValue([VALID_ISSUE]);

    const { useGroupIssuesQuery } = await import(
      "@/features/board/use-issues-query"
    );
    const { wrapper } = createWrapper();
    renderHook(() => useGroupIssuesQuery("KAN", "group-a"), { wrapper });

    await waitFor(() =>
      expect(vi.mocked(fetchApiValidated)).toHaveBeenCalled(),
    );

    const [url] = vi.mocked(fetchApiValidated).mock.calls[0]!;
    expect(url).toContain("group_key=group-a");
  });
});

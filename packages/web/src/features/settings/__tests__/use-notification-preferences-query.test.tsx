/**
 * Tests for useNotificationPreferencesQuery.
 *
 * Covers:
 * - Fetches GET /api/workspaces/:id/notification-preferences and returns
 *   the NotificationPreferenceItem object directly (no envelope unwrap).
 * - Disabled when workspaceId is null.
 *
 * Pattern: real QueryClient + vi.spyOn, mirrors use-notification-mutations.test.tsx.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { NotificationPreferenceItem } from "@kanon/bridge";

vi.mock("@/lib/api-client", () => ({
  fetchApi: vi.fn(),
}));

const WORKSPACE_ID = "ws-prefs-123";

const PREFS: NotificationPreferenceItem = {
  emailMention: true,
  emailAssignment: false,
  emailCycleClosed: true,
};

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

describe("useNotificationPreferencesQuery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches and returns NotificationPreferenceItem directly (no envelope)", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockResolvedValue(PREFS);

    const { wrapper } = createWrapper();
    const { useNotificationPreferencesQuery } = await import(
      "../use-notification-preferences-query"
    );

    const { result } = renderHook(
      () => useNotificationPreferencesQuery(WORKSPACE_ID),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(PREFS);
    expect(fetchApi).toHaveBeenCalledWith(
      `/api/workspaces/${WORKSPACE_ID}/notification-preferences`,
    );
  });

  it("is disabled when workspaceId is null", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockResolvedValue(PREFS);

    const { wrapper } = createWrapper();
    const { useNotificationPreferencesQuery } = await import(
      "../use-notification-preferences-query"
    );

    const { result } = renderHook(
      () => useNotificationPreferencesQuery(null),
      { wrapper },
    );

    // Should not fetch when disabled
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchApi).not.toHaveBeenCalled();
  });
});

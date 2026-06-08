/**
 * Tests for useUpdateNotificationPreferencesMutation.
 *
 * Covers:
 * - NON-VACUOUS: optimistic update writes new prefs to cache BEFORE fetchApi resolves.
 * - Rollback: restores previous object on error.
 * - onSettled: invalidates notificationPreferenceKeys.detail on both success and error.
 *
 * Pattern: real QueryClient + vi.spyOn on invalidateQueries + deferred fetchApi
 * promise for non-vacuous optimistic intermediate assertion.
 * Mirrors use-notification-mutations.test.tsx structure.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { notificationPreferenceKeys } from "@/lib/query-keys";
import type { NotificationPreferenceItem } from "@kanon/bridge";

vi.mock("@/lib/api-client", () => ({
  fetchApi: vi.fn(),
}));

vi.mock("@/stores/toast-store", () => ({
  useToastStore: {
    getState: () => ({
      addToast: vi.fn(),
    }),
  },
}));

const WORKSPACE_ID = "ws-prefs-123";

const INITIAL_PREFS: NotificationPreferenceItem = {
  emailMention: true,
  emailAssignment: true,
  emailCycleClosed: true,
};

const UPDATED_PREFS: NotificationPreferenceItem = {
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

function seedPrefs(
  queryClient: QueryClient,
  prefs: NotificationPreferenceItem,
) {
  queryClient.setQueryData(
    notificationPreferenceKeys.detail(WORKSPACE_ID),
    prefs,
  );
}

function getCache(
  queryClient: QueryClient,
): NotificationPreferenceItem | undefined {
  return queryClient.getQueryData<NotificationPreferenceItem>(
    notificationPreferenceKeys.detail(WORKSPACE_ID),
  );
}

describe("useUpdateNotificationPreferencesMutation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("NON-VACUOUS: optimistic update writes new prefs to cache BEFORE fetchApi resolves", async () => {
    const { fetchApi } = await import("@/lib/api-client");

    let resolveApi!: (value: NotificationPreferenceItem) => void;
    const deferred = new Promise<NotificationPreferenceItem>((resolve) => {
      resolveApi = resolve;
    });
    vi.mocked(fetchApi).mockReturnValue(deferred);

    const { queryClient, wrapper } = createWrapper();
    seedPrefs(queryClient, INITIAL_PREFS);

    const { useUpdateNotificationPreferencesMutation } = await import(
      "../use-update-notification-preferences-mutation"
    );
    const { result } = renderHook(
      () => useUpdateNotificationPreferencesMutation(WORKSPACE_ID),
      { wrapper },
    );

    act(() => {
      result.current.mutate(UPDATED_PREFS);
    });

    // Before API resolves — optimistic update must already be in cache
    await waitFor(() => expect(result.current.isPending).toBe(true));

    const optimistic = getCache(queryClient);
    expect(optimistic).toEqual(UPDATED_PREFS);
    // Specifically the toggled field
    expect(optimistic?.emailAssignment).toBe(false);

    act(() => {
      resolveApi(UPDATED_PREFS);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("error path: rolls back to previous prefs when fetchApi rejects", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockRejectedValue(new Error("Network error"));

    const { queryClient, wrapper } = createWrapper();
    seedPrefs(queryClient, INITIAL_PREFS);

    const { useUpdateNotificationPreferencesMutation } = await import(
      "../use-update-notification-preferences-mutation"
    );
    const { result } = renderHook(
      () => useUpdateNotificationPreferencesMutation(WORKSPACE_ID),
      { wrapper },
    );

    act(() => {
      result.current.mutate(UPDATED_PREFS);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    // Cache should be rolled back to original prefs
    const rolledBack = getCache(queryClient);
    expect(rolledBack).toEqual(INITIAL_PREFS);
    expect(rolledBack?.emailAssignment).toBe(true);
  });

  it("success path: invalidates notificationPreferenceKeys.detail on settle", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockResolvedValue(UPDATED_PREFS);

    const { queryClient, wrapper } = createWrapper();
    seedPrefs(queryClient, INITIAL_PREFS);

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { useUpdateNotificationPreferencesMutation } = await import(
      "../use-update-notification-preferences-mutation"
    );
    const { result } = renderHook(
      () => useUpdateNotificationPreferencesMutation(WORKSPACE_ID),
      { wrapper },
    );

    act(() => {
      result.current.mutate(UPDATED_PREFS);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: notificationPreferenceKeys.detail(WORKSPACE_ID),
      }),
    );
  });

  it("error path: invalidates notificationPreferenceKeys.detail on settle even after error", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockRejectedValue(new Error("Server error"));

    const { queryClient, wrapper } = createWrapper();
    seedPrefs(queryClient, INITIAL_PREFS);

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { useUpdateNotificationPreferencesMutation } = await import(
      "../use-update-notification-preferences-mutation"
    );
    const { result } = renderHook(
      () => useUpdateNotificationPreferencesMutation(WORKSPACE_ID),
      { wrapper },
    );

    act(() => {
      result.current.mutate(UPDATED_PREFS);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: notificationPreferenceKeys.detail(WORKSPACE_ID),
      }),
    );
  });
});

/**
 * Tests for useMarkNotificationReadMutation and useMarkAllNotificationsReadMutation.
 *
 * Covers:
 * - Mark-one-read: NON-VACUOUS optimistic intermediate assertion — asserts
 *   read:true on the cache BEFORE the deferred fetchApi resolves (the key
 *   requirement from KAN-37 slice 1).
 * - Mark-one-read: rollback on error — asserts list is restored to previous.
 * - Mark-one-read: invalidates notificationKeys.list on settle.
 * - Mark-all-read: optimistic update sets all items to read:true.
 * - Mark-all-read: rollback on error.
 *
 * Pattern: real QueryClient + vi.spyOn on invalidateQueries + deferred
 * fetchApi promise for the non-vacuous optimistic intermediate assertion.
 * Mirrors use-subscription-mutations.ts shape; test file mirrors
 * use-transition-mutation.test.tsx structure.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { notificationKeys } from "@/lib/query-keys";
import type { NotificationDashboardItem } from "@kanon/bridge";

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

const WORKSPACE_ID = "ws-test-123";

const NOTIF_UNREAD: NotificationDashboardItem = {
  id: "notif-1",
  kind: "mention",
  issueId: "issue-uuid-1",
  actorId: "actor-uuid-1",
  mentionId: "mention-uuid-1",
  payload: null,
  read: false,
  via: null,
  createdAt: "2026-06-01T10:00:00.000Z",
};

const NOTIF_UNREAD_2: NotificationDashboardItem = {
  id: "notif-2",
  kind: "assignment",
  issueId: "issue-uuid-2",
  actorId: "actor-uuid-2",
  mentionId: null,
  payload: null,
  read: false,
  via: null,
  createdAt: "2026-06-02T10:00:00.000Z",
};

const NOTIF_ALREADY_READ: NotificationDashboardItem = {
  id: "notif-3",
  kind: "cycle_closed",
  issueId: "issue-uuid-3",
  actorId: "actor-uuid-3",
  mentionId: null,
  payload: null,
  read: true,
  via: null,
  createdAt: "2026-06-03T10:00:00.000Z",
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

// Helper: seed the notifications list into cache
function seedNotifications(
  queryClient: QueryClient,
  notifs: NotificationDashboardItem[],
) {
  queryClient.setQueryData(notificationKeys.list(WORKSPACE_ID), notifs);
}

// Helper: read current cache value
function getCache(
  queryClient: QueryClient,
): NotificationDashboardItem[] | undefined {
  return queryClient.getQueryData<NotificationDashboardItem[]>(
    notificationKeys.list(WORKSPACE_ID),
  );
}

describe("useMarkNotificationReadMutation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("NON-VACUOUS: optimistic update sets read:true BEFORE fetchApi resolves", async () => {
    const { fetchApi } = await import("@/lib/api-client");

    // Create a deferred promise so we can inspect cache state mid-flight
    let resolveApi!: (value: { id: string; read: true }) => void;
    const deferred = new Promise<{ id: string; read: true }>((resolve) => {
      resolveApi = resolve;
    });
    vi.mocked(fetchApi).mockReturnValue(deferred);

    const { queryClient, wrapper } = createWrapper();
    seedNotifications(queryClient, [NOTIF_UNREAD, NOTIF_UNREAD_2]);

    const { useMarkNotificationReadMutation } = await import(
      "../use-notification-mutations"
    );
    const { result } = renderHook(
      () => useMarkNotificationReadMutation(WORKSPACE_ID),
      { wrapper },
    );

    // Trigger the mutation
    act(() => {
      result.current.mutate("notif-1");
    });

    // BEFORE resolving the API call — optimistic update must already be written
    await waitFor(() => expect(result.current.isPending).toBe(true));

    const optimisticCache = getCache(queryClient);
    expect(optimisticCache).toBeDefined();
    // notif-1 should be optimistically read
    const optimisticNotif1 = optimisticCache!.find((n) => n.id === "notif-1");
    expect(optimisticNotif1?.read).toBe(true);
    // notif-2 should remain unchanged
    const optimisticNotif2 = optimisticCache!.find((n) => n.id === "notif-2");
    expect(optimisticNotif2?.read).toBe(false);

    // Now resolve the API
    act(() => {
      resolveApi({ id: "notif-1", read: true });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("error path: rolls back to previous list when fetchApi rejects", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockRejectedValue(new Error("Network error"));

    const { queryClient, wrapper } = createWrapper();
    seedNotifications(queryClient, [NOTIF_UNREAD]);

    const { useMarkNotificationReadMutation } = await import(
      "../use-notification-mutations"
    );
    const { result } = renderHook(
      () => useMarkNotificationReadMutation(WORKSPACE_ID),
      { wrapper },
    );

    act(() => {
      result.current.mutate("notif-1");
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    // Cache should be rolled back to read:false
    const rolledBack = getCache(queryClient);
    expect(rolledBack?.[0]?.read).toBe(false);
  });

  it("success path: invalidates notificationKeys.list on settle", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockResolvedValue({ id: "notif-1", read: true });

    const { queryClient, wrapper } = createWrapper();
    seedNotifications(queryClient, [NOTIF_UNREAD]);

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { useMarkNotificationReadMutation } = await import(
      "../use-notification-mutations"
    );
    const { result } = renderHook(
      () => useMarkNotificationReadMutation(WORKSPACE_ID),
      { wrapper },
    );

    act(() => {
      result.current.mutate("notif-1");
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: notificationKeys.list(WORKSPACE_ID),
      }),
    );
  });

  it("error path: invalidates notificationKeys.list on settle even after error", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockRejectedValue(new Error("Server error"));

    const { queryClient, wrapper } = createWrapper();
    seedNotifications(queryClient, [NOTIF_UNREAD]);

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { useMarkNotificationReadMutation } = await import(
      "../use-notification-mutations"
    );
    const { result } = renderHook(
      () => useMarkNotificationReadMutation(WORKSPACE_ID),
      { wrapper },
    );

    act(() => {
      result.current.mutate("notif-1");
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: notificationKeys.list(WORKSPACE_ID),
      }),
    );
  });
});

describe("useMarkAllNotificationsReadMutation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("optimistic update sets ALL notifications to read:true before fetch resolves", async () => {
    const { fetchApi } = await import("@/lib/api-client");

    let resolveApi!: (value: { updated: number }) => void;
    const deferred = new Promise<{ updated: number }>((resolve) => {
      resolveApi = resolve;
    });
    vi.mocked(fetchApi).mockReturnValue(deferred);

    const { queryClient, wrapper } = createWrapper();
    seedNotifications(queryClient, [NOTIF_UNREAD, NOTIF_UNREAD_2]);

    const { useMarkAllNotificationsReadMutation } = await import(
      "../use-notification-mutations"
    );
    const { result } = renderHook(
      () => useMarkAllNotificationsReadMutation(WORKSPACE_ID),
      { wrapper },
    );

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isPending).toBe(true));

    const optimisticCache = getCache(queryClient);
    expect(optimisticCache).toBeDefined();
    expect(optimisticCache!.every((n) => n.read)).toBe(true);

    act(() => {
      resolveApi({ updated: 2 });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("NON-VACUOUS: error path rolls back each notification to its ORIGINAL read value", async () => {
    // Seeds a MIXED set: one already-read (notif-3) + two unread (notif-1, notif-2).
    // A buggy blanket read:false rollback would incorrectly set notif-3 back to false,
    // making this test fail. The correct rollback restores the original snapshot verbatim.
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockRejectedValue(new Error("Network error"));

    const { queryClient, wrapper } = createWrapper();
    const mixed = [NOTIF_UNREAD, NOTIF_UNREAD_2, NOTIF_ALREADY_READ];
    seedNotifications(queryClient, mixed);

    const { useMarkAllNotificationsReadMutation } = await import(
      "../use-notification-mutations"
    );
    const { result } = renderHook(
      () => useMarkAllNotificationsReadMutation(WORKSPACE_ID),
      { wrapper },
    );

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    const rolledBack = getCache(queryClient);
    expect(rolledBack).toHaveLength(3);

    // Each row must be restored to its ORIGINAL value, not a blanket false.
    const rb1 = rolledBack!.find((n) => n.id === "notif-1");
    const rb2 = rolledBack!.find((n) => n.id === "notif-2");
    const rb3 = rolledBack!.find((n) => n.id === "notif-3");
    expect(rb1?.read).toBe(false);  // was originally unread → stays false
    expect(rb2?.read).toBe(false);  // was originally unread → stays false
    expect(rb3?.read).toBe(true);   // was originally read → restored to true (catches blanket-false bug)
  });

  it("success path: invalidates notificationKeys.list on settle", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockResolvedValue({ updated: 2 });

    const { queryClient, wrapper } = createWrapper();
    seedNotifications(queryClient, [NOTIF_UNREAD, NOTIF_UNREAD_2]);

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { useMarkAllNotificationsReadMutation } = await import(
      "../use-notification-mutations"
    );
    const { result } = renderHook(
      () => useMarkAllNotificationsReadMutation(WORKSPACE_ID),
      { wrapper },
    );

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: notificationKeys.list(WORKSPACE_ID),
      }),
    );
  });
});

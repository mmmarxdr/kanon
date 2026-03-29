import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/auth-store";

// ── Mock SseClient ───────────────────────────────────────────────────────

// vi.hoisted ensures these are available inside the hoisted vi.mock factory
const {
  mockConnect,
  mockClose,
  mockOnEvent,
  mockOnStatusChange,
  mockAddToast,
} = vi.hoisted(() => ({
  mockConnect: vi.fn(),
  mockClose: vi.fn(),
  mockOnEvent: vi.fn(),
  mockOnStatusChange: vi.fn(),
  mockAddToast: vi.fn(),
}));

vi.mock("@/lib/sse-client", () => ({
  SseClient: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    close: mockClose,
    onEvent: mockOnEvent,
    onStatusChange: mockOnStatusChange,
  })),
}));

vi.mock("@/stores/toast-store", () => ({
  useToastStore: {
    getState: () => ({ addToast: mockAddToast }),
  },
}));

// Import after mocking
import { SseClient } from "@/lib/sse-client";
import { useSyncEvents } from "@/hooks/use-sync-events";

// ── Helper to set authenticated state ────────────────────────────────────

function setAuthenticated() {
  useAuthStore.setState({
    user: {
      id: "user-1",
      email: "test@test.com",
      displayName: "Tester",
      avatarUrl: null,
    },
    isAuthenticated: true,
    isLoading: false,
  });
}

// ── Test Wrapper ─────────────────────────────────────────────────────────

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("useSyncEvents", () => {
  beforeEach(() => {
    // Reset call counts but preserve mock implementations
    mockConnect.mockReset();
    mockClose.mockReset();
    mockOnEvent.mockReset();
    mockOnStatusChange.mockReset();
    mockAddToast.mockReset();

    // Default: return unsubscribe no-ops
    mockOnEvent.mockReturnValue(() => {});
    mockOnStatusChange.mockReturnValue(() => {});

    // Reset and re-set the SseClient constructor mock implementation
    vi.mocked(SseClient).mockReset();
    vi.mocked(SseClient).mockImplementation(() => ({
      connect: mockConnect,
      close: mockClose,
      onEvent: mockOnEvent,
      onStatusChange: mockOnStatusChange,
    }) as any);

    // Reset auth store
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
    });
  });

  // ── Creates SseClient and connects on mount ───────────────────────────

  it("creates SseClient and connects on mount when authenticated", () => {
    setAuthenticated();

    renderHook(() => useSyncEvents(), { wrapper: createWrapper() });

    expect(SseClient).toHaveBeenCalledOnce();
    expect(mockConnect).toHaveBeenCalledOnce();
  });

  // ── Invalidates queries on sync_complete event ────────────────────────

  it("invalidates queries on sync_complete event", () => {
    setAuthenticated();

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        children,
      );

    renderHook(() => useSyncEvents(), { wrapper });

    // Get the event callback that was registered
    expect(mockOnEvent).toHaveBeenCalledOnce();
    const eventCallback = mockOnEvent.mock.calls[0]![0];

    // Simulate sync_complete event
    act(() => {
      eventCallback({ type: "sync_complete", timestamp: "now" });
    });

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["issues"] }),
    );
  });

  // ── Invalidates queries on reconnected event ──────────────────────────

  it("invalidates queries on reconnected event", () => {
    setAuthenticated();

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        children,
      );

    renderHook(() => useSyncEvents(), { wrapper });

    const eventCallback = mockOnEvent.mock.calls[0]![0];

    act(() => {
      eventCallback({ type: "reconnected", timestamp: "now" });
    });

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["issues"] }),
    );
  });

  // ── Returns status from SseClient ─────────────────────────────────────

  it("returns status from SseClient", () => {
    setAuthenticated();

    // Capture the status callback
    mockOnStatusChange.mockImplementation((cb: (status: string) => void) => {
      // Simulate immediate notification with current status
      cb("connecting");
      return () => {};
    });

    const { result } = renderHook(() => useSyncEvents(), {
      wrapper: createWrapper(),
    });

    expect(result.current.status).toBe("connecting");
  });

  // ── Cleans up (closes) on unmount ─────────────────────────────────────

  it("cleans up (closes) on unmount", () => {
    setAuthenticated();

    const { unmount } = renderHook(() => useSyncEvents(), {
      wrapper: createWrapper(),
    });

    expect(mockClose).not.toHaveBeenCalled();

    unmount();

    expect(mockClose).toHaveBeenCalledOnce();
  });

  // ── Does not connect when not authenticated ───────────────────────────

  it("does not connect when not authenticated", () => {
    // isAuthenticated is false (default)
    renderHook(() => useSyncEvents(), { wrapper: createWrapper() });

    expect(SseClient).not.toHaveBeenCalled();
    expect(mockConnect).not.toHaveBeenCalled();
  });

  // ── syncHistory tracks events ─────────────────────────────────────────

  it("syncHistory tracks sync_complete events", () => {
    setAuthenticated();

    const { result } = renderHook(() => useSyncEvents(), {
      wrapper: createWrapper(),
    });

    const eventCallback = mockOnEvent.mock.calls[0]![0];

    act(() => {
      eventCallback({ type: "sync_complete", timestamp: "2026-03-22T10:00:00Z", changedCount: 3 });
    });

    expect(result.current.syncHistory).toHaveLength(1);
    expect(result.current.syncHistory[0]!.type).toBe("sync_complete");
  });

  it("syncHistory caps at 20 events", () => {
    setAuthenticated();

    const { result } = renderHook(() => useSyncEvents(), {
      wrapper: createWrapper(),
    });

    const eventCallback = mockOnEvent.mock.calls[0]![0];

    act(() => {
      for (let i = 0; i < 25; i++) {
        eventCallback({
          type: "sync_complete",
          timestamp: `2026-03-22T10:${String(i).padStart(2, "0")}:00Z`,
          changedCount: i,
        });
      }
    });

    expect(result.current.syncHistory).toHaveLength(20);
  });

  it("syncHistory tracks sync_error events", () => {
    setAuthenticated();

    const { result } = renderHook(() => useSyncEvents(), {
      wrapper: createWrapper(),
    });

    const eventCallback = mockOnEvent.mock.calls[0]![0];

    act(() => {
      eventCallback({ type: "sync_error", timestamp: "2026-03-22T10:00:00Z", message: "Timeout" });
    });

    expect(result.current.syncHistory).toHaveLength(1);
    expect(result.current.syncHistory[0]!.type).toBe("sync_error");
  });

  // ── lastSyncAt updates on sync_complete ───────────────────────────────

  it("lastSyncAt updates on sync_complete", () => {
    setAuthenticated();

    const { result } = renderHook(() => useSyncEvents(), {
      wrapper: createWrapper(),
    });

    expect(result.current.lastSyncAt).toBeNull();

    const eventCallback = mockOnEvent.mock.calls[0]![0];

    act(() => {
      eventCallback({ type: "sync_complete", timestamp: "2026-03-22T12:00:00Z", changedCount: 1 });
    });

    expect(result.current.lastSyncAt).toBe("2026-03-22T12:00:00Z");
  });

  // ── triggerSync calls POST /api/events/sync/trigger ───────────────────

  it("triggerSync calls API and sets isManualSyncing", async () => {
    setAuthenticated();

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ triggered: true }), { status: 200 }),
    );

    const { result } = renderHook(() => useSyncEvents(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.triggerSync();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/events/sync/trigger",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      }),
    );

    fetchMock.mockRestore();
  });

  // ── Toast on sync_complete with changes ───────────────────────────────

  it("shows success toast on sync_complete with changedCount > 0", () => {
    setAuthenticated();

    renderHook(() => useSyncEvents(), { wrapper: createWrapper() });

    const eventCallback = mockOnEvent.mock.calls[0]![0];

    act(() => {
      eventCallback({ type: "sync_complete", timestamp: "now", changedCount: 3 });
    });

    expect(mockAddToast).toHaveBeenCalledWith("Synced 3 items from Engram", "success");
  });

  it("does not show toast on sync_complete with changedCount 0", () => {
    setAuthenticated();

    renderHook(() => useSyncEvents(), { wrapper: createWrapper() });

    const eventCallback = mockOnEvent.mock.calls[0]![0];

    act(() => {
      eventCallback({ type: "sync_complete", timestamp: "now", changedCount: 0 });
    });

    expect(mockAddToast).not.toHaveBeenCalled();
  });

  // ── Toast on sync_error ───────────────────────────────────────────────

  it("shows error toast on sync_error", () => {
    setAuthenticated();

    renderHook(() => useSyncEvents(), { wrapper: createWrapper() });

    const eventCallback = mockOnEvent.mock.calls[0]![0];

    act(() => {
      eventCallback({ type: "sync_error", timestamp: "now", message: "Connection timeout" });
    });

    expect(mockAddToast).toHaveBeenCalledWith("Sync error: Connection timeout", "error");
  });
});

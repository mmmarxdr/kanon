/**
 * Tests for useDomainEvents — SSE handler invalidation graph.
 *
 * Strategy (Design D1 / Option B real-harness):
 *   - Install a FakeEventSource on globalThis.EventSource in beforeEach.
 *   - Use real QueryClient + vi.spyOn(queryClient, "invalidateQueries").
 *   - Dispatch synthetic events via FakeEventSource.lastInstance!.dispatch()
 *     wrapped in act() so React schedules state changes deterministically.
 *
 * FakeEventSource only implements what useDomainEvents actually calls:
 *   addEventListener / removeEventListener / close.
 * onerror / onmessage / onopen setters are intentionally omitted (Risk R2 in design).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { issueKeys, cycleKeys, projectKeys } from "@/lib/query-keys";

// ─── FakeEventSource ────────────────────────────────────────────────────────

class FakeEventSource {
  public withCredentials = false;
  public readyState = 0;
  public url: string;
  private listeners = new Map<string, Set<(ev: MessageEvent) => void>>();

  constructor(url: string, init?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = init?.withCredentials ?? false;
    FakeEventSource.lastInstance = this;
  }

  addEventListener(type: string, fn: (ev: MessageEvent) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }

  removeEventListener(type: string, fn: (ev: MessageEvent) => void): void {
    this.listeners.get(type)?.delete(fn);
  }

  close(): void {
    this.readyState = 2;
  }

  /**
   * Test-only: synchronously dispatch an event to all registered listeners.
   * Wrap in act() at the call site so React processes state updates.
   */
  dispatch(type: string, data: unknown = {}): void {
    const ev = new MessageEvent(type, { data: JSON.stringify(data) });
    this.listeners.get(type)?.forEach((fn) => fn(ev));
  }

  static lastInstance: FakeEventSource | null = null;
}

// ─── Test helpers ────────────────────────────────────────────────────────────

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

const WORKSPACE_ID = "ws-test";

// ─── Suite ───────────────────────────────────────────────────────────────────

describe("useDomainEvents", () => {
  beforeEach(() => {
    FakeEventSource.lastInstance = null;
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // ── issue.transitioned ────────────────────────────────────────────────────

  it("issue.transitioned → invalidates issueKeys.all AND cycleKeys.all", async () => {
    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { useDomainEvents } = await import("../use-domain-events");
    renderHook(() => useDomainEvents(WORKSPACE_ID), { wrapper });

    act(() => {
      FakeEventSource.lastInstance!.dispatch("issue.transitioned", {});
    });

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: issueKeys.all }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: cycleKeys.all }),
    );
  });

  // ── issue.updated ─────────────────────────────────────────────────────────

  it("issue.updated → invalidates issueKeys.all AND cycleKeys.all", async () => {
    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { useDomainEvents } = await import("../use-domain-events");
    renderHook(() => useDomainEvents(WORKSPACE_ID), { wrapper });

    act(() => {
      FakeEventSource.lastInstance!.dispatch("issue.updated", {});
    });

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: issueKeys.all }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: cycleKeys.all }),
    );
  });

  // ── issue.created ─────────────────────────────────────────────────────────

  it("issue.created → invalidates issueKeys.all AND cycleKeys.all", async () => {
    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { useDomainEvents } = await import("../use-domain-events");
    renderHook(() => useDomainEvents(WORKSPACE_ID), { wrapper });

    act(() => {
      FakeEventSource.lastInstance!.dispatch("issue.created", {});
    });

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: issueKeys.all }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: cycleKeys.all }),
    );
  });

  // ── issue.assigned ────────────────────────────────────────────────────────

  it("issue.assigned → invalidates issueKeys.all AND cycleKeys.all", async () => {
    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { useDomainEvents } = await import("../use-domain-events");
    renderHook(() => useDomainEvents(WORKSPACE_ID), { wrapper });

    act(() => {
      FakeEventSource.lastInstance!.dispatch("issue.assigned", {});
    });

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: issueKeys.all }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: cycleKeys.all }),
    );
  });

  // ── Negative: project.created ─────────────────────────────────────────────

  it("project.created → invalidates projectKeys.all but NOT cycleKeys.all", async () => {
    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { useDomainEvents } = await import("../use-domain-events");
    renderHook(() => useDomainEvents(WORKSPACE_ID), { wrapper });

    act(() => {
      FakeEventSource.lastInstance!.dispatch("project.created", {});
    });

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: projectKeys.all }),
    );
    expect(invalidateSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: cycleKeys.all }),
    );
  });

  // ── Negative: member.added ────────────────────────────────────────────────

  it("member.added → does NOT invalidate cycleKeys.all", async () => {
    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { useDomainEvents } = await import("../use-domain-events");
    renderHook(() => useDomainEvents(WORKSPACE_ID), { wrapper });

    act(() => {
      FakeEventSource.lastInstance!.dispatch("member.added", {});
    });

    expect(invalidateSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: cycleKeys.all }),
    );
  });

  // ── cycle.deleted (REQ-WEB-CACHE-001) ────────────────────────────────────

  it("cycle.deleted → invalidates cycleKeys.all", async () => {
    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { useDomainEvents } = await import("../use-domain-events");
    renderHook(() => useDomainEvents(WORKSPACE_ID), { wrapper });

    act(() => {
      FakeEventSource.lastInstance!.dispatch("cycle.deleted", {
        cycleId: "cycle-123",
        projectId: "project-1",
      });
    });

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: cycleKeys.all }),
    );
  });

  it("cycle.deleted handler registered exactly once per mount (no duplicate listener on re-render)", async () => {
    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { useDomainEvents } = await import("../use-domain-events");
    const { rerender } = renderHook(() => useDomainEvents(WORKSPACE_ID), { wrapper });

    // Re-render with same workspaceId — must not duplicate the listener
    rerender();

    act(() => {
      FakeEventSource.lastInstance!.dispatch("cycle.deleted", {
        cycleId: "cycle-123",
        projectId: "project-1",
      });
    });

    // cycleKeys.all should be invalidated exactly once
    const cycleCalls = invalidateSpy.mock.calls.filter(
      (call) =>
        call[0] != null &&
        typeof call[0] === "object" &&
        "queryKey" in call[0] &&
        JSON.stringify((call[0] as { queryKey: unknown }).queryKey) ===
          JSON.stringify(cycleKeys.all),
    );
    expect(cycleCalls).toHaveLength(1);
  });

  it("cycle.deleted handler does NOT throw when a deleted cycle was in cache (graceful degradation)", async () => {
    const { queryClient, wrapper } = createWrapper();

    // Pre-populate cache with a cycle entry
    queryClient.setQueryData(["cycles", "cycle-123"], {
      id: "cycle-123",
      name: "Sprint 7",
      state: "done",
    });

    const { useDomainEvents } = await import("../use-domain-events");
    renderHook(() => useDomainEvents(WORKSPACE_ID), { wrapper });

    // Must not throw when the deleted cycle is in cache
    expect(() => {
      act(() => {
        FakeEventSource.lastInstance!.dispatch("cycle.deleted", {
          cycleId: "cycle-123",
          projectId: "project-1",
        });
      });
    }).not.toThrow();

    // cycleKeys.all invalidated so the stale entry will be refetched
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    act(() => {
      FakeEventSource.lastInstance!.dispatch("cycle.deleted", {
        cycleId: "cycle-456",
        projectId: "project-1",
      });
    });
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: cycleKeys.all }),
    );
  });
});

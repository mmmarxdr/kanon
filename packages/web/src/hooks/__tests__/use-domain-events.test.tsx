/**
 * Tests for useDomainEvents — SSE handler invalidation graph.
 *
 * KAN-88 Slice 1: scope the SSE invalidation storm.
 *
 * Strategy (Design D1 / Option B real-harness):
 *   - Install a FakeEventSource on globalThis.EventSource in beforeEach.
 *   - Use real QueryClient + vi.spyOn(queryClient, "invalidateQueries").
 *   - Dispatch synthetic events via FakeEventSource.lastInstance!.dispatch()
 *     wrapped in act() so React schedules state changes deterministically.
 *
 * FakeEventSource only implements what useDomainEvents actually calls:
 *   addEventListener / removeEventListener / close.
 * onerror / onmessage / onopen setters are intentionally omitted.
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
const PROJECT_KEY = "PROJ";

// ─── Suite ───────────────────────────────────────────────────────────────────

describe("useDomainEvents — KAN-88 Slice 1: scoped invalidation", () => {
  beforeEach(() => {
    FakeEventSource.lastInstance = null;
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // ── KAN-88-S1-A: issue.transitioned scoped invalidation ───────────────────

  it("KAN-88-S1-A: issue.transitioned with projectKey → invalidates issueKeys.list(projectKey) and issueKeys.groups(projectKey), NOT issueKeys.all", async () => {
    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { useDomainEvents } = await import("../use-domain-events");
    renderHook(() => useDomainEvents(WORKSPACE_ID), { wrapper });

    act(() => {
      FakeEventSource.lastInstance!.dispatch("issue.transitioned", {
        payload: { issueKey: "PROJ-1", issueId: "id-1", projectKey: PROJECT_KEY, from: "todo", to: "in_progress" },
      });
    });

    // Must invalidate the scoped list key
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: issueKeys.list(PROJECT_KEY) }),
    );
    // Must invalidate the scoped groups key
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: issueKeys.groups(PROJECT_KEY) }),
    );
    // Must NOT nuke the entire issue cache
    expect(invalidateSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: issueKeys.all }),
    );
    // Must NOT invalidate detail/documents/context keys
    expect(invalidateSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: issueKeys.details() }),
    );
    expect(invalidateSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: issueKeys.backlogs() }),
    );
  });

  it("KAN-88-S1-A: issue.transitioned without projectKey (degraded payload) → falls back to issueKeys.lists(), NOT issueKeys.all", async () => {
    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { useDomainEvents } = await import("../use-domain-events");
    renderHook(() => useDomainEvents(WORKSPACE_ID), { wrapper });

    act(() => {
      // Old payload shape — no projectKey
      FakeEventSource.lastInstance!.dispatch("issue.transitioned", {
        payload: { issueKey: "PROJ-1", issueId: "id-1", from: "todo", to: "in_progress" },
      });
    });

    // Falls back to lists prefix (still excludes detail/documents/context)
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: issueKeys.lists() }),
    );
    // Must NOT nuke the entire issue cache
    expect(invalidateSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: issueKeys.all }),
    );
  });

  // ── KAN-88-S1-A: issue.updated scoped invalidation ────────────────────────

  it("KAN-88-S1-A: issue.updated with projectKey → invalidates list+groups, NOT issueKeys.all", async () => {
    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { useDomainEvents } = await import("../use-domain-events");
    renderHook(() => useDomainEvents(WORKSPACE_ID), { wrapper });

    act(() => {
      FakeEventSource.lastInstance!.dispatch("issue.updated", {
        payload: { issueKey: "PROJ-2", issueId: "id-2", projectKey: PROJECT_KEY, fields: ["title"] },
      });
    });

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: issueKeys.list(PROJECT_KEY) }),
    );
    expect(invalidateSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: issueKeys.all }),
    );
  });

  it("issue.deleted removes the stale detail and invalidates the scoped list", async () => {
    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(issueKeys.detail("PROJ-9"), { id: "id-9" });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { useDomainEvents } = await import("../use-domain-events");
    renderHook(() => useDomainEvents(WORKSPACE_ID), { wrapper });
    act(() => {
      FakeEventSource.lastInstance!.dispatch("issue.deleted", {
        payload: { issueKey: "PROJ-9", issueId: "id-9", projectKey: PROJECT_KEY },
      });
    });

    expect(queryClient.getQueryData(issueKeys.detail("PROJ-9"))).toBeUndefined();
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: issueKeys.list(PROJECT_KEY) }),
    );
  });

  // ── KAN-88-S1-A: issue.created scoped invalidation ────────────────────────

  it("KAN-88-S1-A: issue.created with projectKey → invalidates list+groups, NOT issueKeys.all", async () => {
    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { useDomainEvents } = await import("../use-domain-events");
    renderHook(() => useDomainEvents(WORKSPACE_ID), { wrapper });

    act(() => {
      FakeEventSource.lastInstance!.dispatch("issue.created", {
        payload: { issueKey: "PROJ-3", issueId: "id-3", projectKey: PROJECT_KEY, title: "New issue" },
      });
    });

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: issueKeys.list(PROJECT_KEY) }),
    );
    expect(invalidateSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: issueKeys.all }),
    );
  });

  // ── KAN-88-S1-A: issue.assigned scoped invalidation ──────────────────────

  it("KAN-88-S1-A: issue.assigned with projectKey → invalidates list+groups, NOT issueKeys.all", async () => {
    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { useDomainEvents } = await import("../use-domain-events");
    renderHook(() => useDomainEvents(WORKSPACE_ID), { wrapper });

    act(() => {
      FakeEventSource.lastInstance!.dispatch("issue.assigned", {
        payload: { issueKey: "PROJ-4", issueId: "id-4", projectKey: PROJECT_KEY, from: null, to: "member-1" },
      });
    });

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: issueKeys.list(PROJECT_KEY) }),
    );
    expect(invalidateSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: issueKeys.all }),
    );
  });

  // ── KAN-88-S1-B: cycleKeys.all gated on active observers ─────────────────

  it("KAN-88-S1-B: issue.transitioned does NOT invalidate cycleKeys.all when no active cycle query exists", async () => {
    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    // No cycle queries mounted — getQueryCache().findAll({ type: 'active' }) returns []

    const { useDomainEvents } = await import("../use-domain-events");
    renderHook(() => useDomainEvents(WORKSPACE_ID), { wrapper });

    act(() => {
      FakeEventSource.lastInstance!.dispatch("issue.transitioned", {
        payload: { issueKey: "PROJ-1", issueId: "id-1", projectKey: PROJECT_KEY, from: "todo", to: "in_progress" },
      });
    });

    // cycleKeys.all must NOT be invalidated — no active cycle observer
    expect(invalidateSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: cycleKeys.all }),
    );
  });

  it("KAN-88-S1-B: issue.transitioned DOES invalidate cycleKeys.all when an active cycle query exists", async () => {
    const { queryClient, wrapper } = createWrapper();

    // Mount a real useQuery for cycleKeys.all inside the wrapper so TanStack
    // registers it as an active observer. renderHook accepts multiple hooks via
    // a single wrapper component — we render BOTH useDomainEvents and a cycle
    // query by using a combined render.
    const { useQuery } = await import("@tanstack/react-query");
    // Pre-populate the cache so useQuery returns immediately without fetching
    queryClient.setQueryData(cycleKeys.all, []);

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { useDomainEvents } = await import("../use-domain-events");

    // Render both hooks together — useCycleObserver keeps the query active
    renderHook(
      () => {
        useDomainEvents(WORKSPACE_ID);
        // Mounting useQuery with staleTime=Infinity prevents any background fetch
        useQuery({ queryKey: cycleKeys.all, queryFn: () => Promise.resolve([]), staleTime: Infinity });
      },
      { wrapper },
    );

    act(() => {
      FakeEventSource.lastInstance!.dispatch("issue.transitioned", {
        payload: { issueKey: "PROJ-1", issueId: "id-1", projectKey: PROJECT_KEY, from: "todo", to: "in_progress" },
      });
    });

    // cycleKeys.all MUST be invalidated — active cycle observer present
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: cycleKeys.all }),
    );
  });

  // ── KAN-88-S1-B: work_session events — issue-scoped, no cycle blast ───────

  it("KAN-88-S1-B: work_session.started → invalidates issueKeys.lists() (not issueKeys.all), no cycle invalidation without active observer", async () => {
    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { useDomainEvents } = await import("../use-domain-events");
    renderHook(() => useDomainEvents(WORKSPACE_ID), { wrapper });

    act(() => {
      FakeEventSource.lastInstance!.dispatch("work_session.started", {
        payload: { issueKey: "PROJ-1", issueId: "id-1", memberId: "m-1" },
      });
    });

    // Must NOT nuke the entire issue cache
    expect(invalidateSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: issueKeys.all }),
    );
    // Must NOT unconditionally invalidate cycles
    expect(invalidateSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: cycleKeys.all }),
    );
  });

  // ── Regression: cycle.deleted still invalidates cycleKeys.all ────────────

  it("cycle.deleted → still invalidates cycleKeys.all (unconditional — it's a structural change)", async () => {
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

  // ── No-duplicate listener on re-render ────────────────────────────────────

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

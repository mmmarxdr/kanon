/**
 * KAN-105 PR3 — Test for ppm.forecast.updated SSE handler in useDomainEvents.
 *
 * RED phase: written before the handler is added.
 *
 * Strategy: reuse the FakeEventSource pattern from use-domain-events.test.tsx.
 * Dispatches a ppm.forecast.updated event and asserts that
 * scheduleTimelineKeys.projects() is invalidated (broad, project-keyed
 * by projectId which differs from projectKey — so we use the parent key).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { scheduleTimelineKeys } from "@/lib/query-keys";

// ─── FakeEventSource (same shape as in use-domain-events.test.tsx) ───────────

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

  dispatch(type: string, data: unknown = {}): void {
    const ev = new MessageEvent(type, { data: JSON.stringify(data) });
    this.listeners.get(type)?.forEach((fn) => fn(ev));
  }

  static lastInstance: FakeEventSource | null = null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

describe("useDomainEvents — ppm.forecast.updated SSE handler (KAN-105 PR3)", () => {
  beforeEach(() => {
    FakeEventSource.lastInstance = null;
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("ppm.forecast.updated → invalidates scheduleTimelineKeys.projects() (broad project list)", async () => {
    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { useDomainEvents } = await import("../use-domain-events");
    renderHook(() => useDomainEvents(WORKSPACE_ID), { wrapper });

    act(() => {
      FakeEventSource.lastInstance!.dispatch("ppm.forecast.updated", {
        projectId: "project-123",
        issueCount: 12,
        criticalCount: 3,
        worstSlipDays: 5,
      });
    });

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: scheduleTimelineKeys.projects(),
      }),
    );
  });

  it("ppm.forecast.updated does NOT invalidate unrelated issue or project keys", async () => {
    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { useDomainEvents } = await import("../use-domain-events");
    renderHook(() => useDomainEvents(WORKSPACE_ID), { wrapper });

    act(() => {
      FakeEventSource.lastInstance!.dispatch("ppm.forecast.updated", {
        projectId: "project-123",
        issueCount: 8,
        criticalCount: 1,
        worstSlipDays: 0,
      });
    });

    // Must NOT blast unrelated caches
    expect(invalidateSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["issues"] }),
    );
    expect(invalidateSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["projects"] }),
    );
  });
});

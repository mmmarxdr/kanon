import { StrictMode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MemoryWorkCaptureStorage,
  SerialWorkCaptureLock,
  WorkCaptureBrowserStore,
  type CaptureScope,
} from "@/lib/work-capture-browser-store";
import { createWorkCaptureLifecycle } from "@/lib/work-capture-lifecycle";
import { useLocalCaptureActivity } from "../use-local-capture-activity";

const scope: CaptureScope = {
  principalId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
};

function fakeRegistry() {
  const snapshot = { scope: null, generation: 0, entries: {} };
  return {
    activateScope: vi.fn().mockResolvedValue(undefined),
    recordActivity: vi.fn().mockResolvedValue(undefined),
    releaseScope: vi.fn().mockResolvedValue(undefined),
    getSnapshot: vi.fn(() => snapshot),
    subscribe: vi.fn(() => () => undefined),
  };
}

function store(storage = new MemoryWorkCaptureStorage(), lock = new SerialWorkCaptureLock()) {
  return new WorkCaptureBrowserStore({
    storage,
    lock,
    randomUUID: () => "33333333-3333-4333-8333-333333333333",
    now: () => Date.now(),
  });
}

describe("local work-capture activity lifecycle", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("claims only the nearest issue marker or current-detail fallback", async () => {
    const registry = fakeRegistry();
    const lifecycle = createWorkCaptureLifecycle({
      registry,
      store: store(),
      tabId: "tab-one",
      documentTarget: document,
      windowTarget: window,
    });
    await lifecycle.activateScope(scope);
    const cleanup = lifecycle.installActivityListeners();

    const card = document.createElement("div");
    card.dataset.issueKey = "KAN-7";
    const nested = document.createElement("button");
    card.append(nested);
    document.body.append(card);
    nested.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));

    const detail = document.createElement("section");
    detail.dataset.currentIssueKey = "KAN-9";
    const input = document.createElement("input");
    detail.append(input);
    document.body.append(detail);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));

    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(registry.recordActivity.mock.calls.map(([key]) => key)).toEqual(["KAN-7", "KAN-9"]);
    cleanup();
  });

  it("does not release or duplicate hydration during React Strict Mode setup-cleanup-setup", async () => {
    const registry = fakeRegistry();
    const lifecycle = createWorkCaptureLifecycle({
      registry,
      store: store(),
      tabId: "strict-tab",
      documentTarget: document,
      windowTarget: window,
    });

    const { unmount } = renderHook(
      () => useLocalCaptureActivity(scope, lifecycle),
      { wrapper: StrictMode },
    );
    await act(async () => Promise.resolve());
    expect(registry.activateScope).toHaveBeenCalledTimes(1);

    unmount();
    expect(registry.releaseScope).not.toHaveBeenCalled();
  });

  it("releases only when the final live tab leaves the scope", async () => {
    const storage = new MemoryWorkCaptureStorage();
    const lock = new SerialWorkCaptureLock();
    const firstRegistry = fakeRegistry();
    const secondRegistry = fakeRegistry();
    const first = createWorkCaptureLifecycle({
      registry: firstRegistry,
      store: store(storage, lock),
      tabId: "tab-a",
      documentTarget: document,
      windowTarget: window,
    });
    const second = createWorkCaptureLifecycle({
      registry: secondRegistry,
      store: store(storage, lock),
      tabId: "tab-b",
      documentTarget: document,
      windowTarget: window,
    });
    await first.activateScope(scope);
    await second.activateScope(scope);

    await first.deactivateCurrent("logout");
    expect(firstRegistry.releaseScope).not.toHaveBeenCalled();
    await second.deactivateCurrent("logout");
    expect(secondRegistry.releaseScope).toHaveBeenCalledWith(scope, { keepalive: false });
  });

  it("pagehide is explicitly best-effort and React cleanup only unregisters listeners", async () => {
    const registry = fakeRegistry();
    const lifecycle = createWorkCaptureLifecycle({
      registry,
      store: store(),
      tabId: "pagehide-tab",
      documentTarget: document,
      windowTarget: window,
    });
    await lifecycle.activateScope(scope);
    const cleanup = lifecycle.installActivityListeners();
    cleanup();
    expect(registry.releaseScope).not.toHaveBeenCalled();

    const activeCleanup = lifecycle.installActivityListeners();
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    await waitFor(() =>
      expect(registry.releaseScope).toHaveBeenCalledWith(scope, { keepalive: true }),
    );
    activeCleanup();
  });
});

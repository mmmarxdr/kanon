import { describe, expect, it, vi } from "vitest";
import {
  MemoryWorkCaptureStorage,
  SerialWorkCaptureLock,
  WorkCaptureBrowserStore,
  type CaptureScope,
} from "../work-capture-browser-store";
import { createWorkCaptureLifecycle } from "../work-capture-lifecycle";

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

describe("work-capture lifecycle tab identity", () => {
  it("keeps cloned live tabs distinct so only the final tab releases", async () => {
    const storage = new MemoryWorkCaptureStorage();
    const lock = new SerialWorkCaptureLock();
    const createStore = () =>
      new WorkCaptureBrowserStore({
        storage,
        lock,
        randomUUID: () => "33333333-3333-4333-8333-333333333333",
        now: () => 1_000,
      });
    const firstRegistry = fakeRegistry();
    const secondRegistry = fakeRegistry();
    const first = createWorkCaptureLifecycle({
      registry: firstRegistry,
      store: createStore(),
      tabId: "cloned-tab",
      documentTarget: document,
      windowTarget: window,
    });
    const second = createWorkCaptureLifecycle({
      registry: secondRegistry,
      store: createStore(),
      tabId: "cloned-tab",
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
});

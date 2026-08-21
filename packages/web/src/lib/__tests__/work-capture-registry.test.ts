import { ApiError } from "@/lib/api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MemoryWorkCaptureStorage,
  SerialWorkCaptureLock,
  WorkCaptureBrowserStore,
  type CaptureScope,
} from "../work-capture-browser-store";
import { WorkCaptureRegistry } from "../work-capture-registry";

const scopeA: CaptureScope = {
  principalId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
};
const scopeB: CaptureScope = {
  principalId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  workspaceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
};
const ownerId = "33333333-3333-4333-8333-333333333333";
const epoch1 = "44444444-4444-4444-8444-444444444444";
const epoch2 = "55555555-5555-4555-8555-555555555555";
const commandIds = [
  "66666666-6666-4666-8666-666666666666",
  "77777777-7777-4777-8777-777777777777",
  "88888888-8888-4888-8888-888888888888",
];

function page(
  scope: CaptureScope,
  intents: Array<{ issueKey: string; epoch: string; leaseGeneration: number }>,
  nextCursor: string | null = null
) {
  return {
    ...scope,
    intents: intents.map((intent) => ({ ...intent, state: "capturing" as const })),
    nextCursor,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks() {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

function harness(request = vi.fn()) {
  const store = new WorkCaptureBrowserStore({
    storage: new MemoryWorkCaptureStorage(),
    lock: new SerialWorkCaptureLock(),
    randomUUID: () => ownerId,
    now: () => Date.now(),
  });
  let id = 0;
  const registry = new WorkCaptureRegistry({
    store,
    request,
    randomUUID: () => commandIds[id++] ?? commandIds.at(-1)!,
    schedule: (fn, delay) => setTimeout(fn, delay),
    cancelSchedule: (token) => clearTimeout(token as ReturnType<typeof setTimeout>),
    retryBaseMs: 100,
    retryMaxMs: 400,
  });
  return { registry, store, request };
}

function response(commandId: string, deliveryStatus: "acknowledged" | "pending" = "acknowledged") {
  return {
    ok: true as const,
    commandId,
    deliveryStatus,
    captureIntent: { epoch: epoch1, leaseGeneration: 1, state: "capturing" as const },
  };
}

async function hydrateOne(registry: WorkCaptureRegistry, request: ReturnType<typeof vi.fn>) {
  request.mockResolvedValueOnce(
    page(scopeA, [{ issueKey: "KAN-1", epoch: epoch1, leaseGeneration: 1 }])
  );
  await registry.activateScope(scopeA);
}

describe("WorkCaptureRegistry", () => {
  beforeEach(() => vi.useRealTimers());

  it("hydrates every page and commits atomically only after the final validated page", async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const { registry, request } = harness(
      vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    );
    const hydration = registry.activateScope(scopeA);
    first.resolve(page(scopeA, [{ issueKey: "KAN-1", epoch: epoch1, leaseGeneration: 1 }], epoch1));
    await Promise.resolve();
    await Promise.resolve();
    expect(registry.getSnapshot().entries).toEqual({});

    second.resolve(page(scopeA, [{ issueKey: "KAN-2", epoch: epoch2, leaseGeneration: 3 }]));
    await hydration;

    expect(Object.keys(registry.getSnapshot().entries).sort()).toEqual(["KAN-1", "KAN-2"]);
    expect(registry.getSnapshot().entries["KAN-1"]?.status).toBe("passive");
    expect(request.mock.calls[1]?.[0]).toContain(`cursor=${epoch1}`);
  });

  it.each([
    ["malformed page", { nope: true }],
    ["principal echo mismatch", page({ ...scopeA, principalId: scopeB.principalId }, [])],
    ["workspace echo mismatch", page({ ...scopeA, workspaceId: scopeB.workspaceId }, [])],
    ["cursor fails to progress", page(scopeA, [], epoch1)],
  ])("rejects %s without partially committing hydration", async (_name, invalid) => {
    const request = vi.fn();
    if (_name === "cursor fails to progress") {
      request
        .mockResolvedValueOnce(
          page(scopeA, [{ issueKey: "KAN-1", epoch: epoch1, leaseGeneration: 1 }], epoch1)
        )
        .mockResolvedValueOnce(invalid);
    } else {
      request.mockResolvedValueOnce(invalid);
    }
    const { registry } = harness(request);

    await expect(registry.activateScope(scopeA)).rejects.toThrow();
    expect(registry.getSnapshot().entries).toEqual({});
  });

  it("ignores stale hydration from a prior principal generation", async () => {
    const old = deferred<unknown>();
    const request = vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(
        page(scopeB, [{ issueKey: "NEW-1", epoch: epoch2, leaseGeneration: 1 }])
      );
    const { registry } = harness(request);
    const stale = registry.activateScope(scopeA);
    await registry.activateScope(scopeB);
    old.resolve(page(scopeA, [{ issueKey: "OLD-1", epoch: epoch1, leaseGeneration: 1 }]));
    await stale;

    expect(registry.getSnapshot().scope).toEqual(scopeB);
    expect(registry.getSnapshot().entries["NEW-1"]?.status).toBe("passive");
    expect(registry.getSnapshot().entries["OLD-1"]).toBeUndefined();
  });

  it("keeps hydrated explicit/MCP ownership passive with no heartbeat or release I/O", async () => {
    vi.useFakeTimers();
    const { registry, request } = harness(vi.fn());
    await hydrateOne(registry, request);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(request).toHaveBeenCalledTimes(1);
    expect(registry.getSnapshot().entries["KAN-1"]?.status).toBe("passive");
  });

  it("claims only the exact hydrated issue and persists bytes before network", async () => {
    const request = vi.fn();
    const { registry, store } = harness(request);
    request.mockResolvedValueOnce(
      page(scopeA, [
        { issueKey: "KAN-1", epoch: epoch1, leaseGeneration: 1 },
        { issueKey: "KAN-2", epoch: epoch2, leaseGeneration: 2 },
      ])
    );
    await registry.activateScope(scopeA);
    request.mockImplementationOnce(async (_path, _schema, init: RequestInit) => {
      const pending = await store.listCommands(scopeA);
      expect(pending).toHaveLength(1);
      expect(pending[0]?.body).toBe(init.body);
      return response(commandIds[0]!);
    });

    await registry.recordActivity("KAN-2");

    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[0]).toBe("/api/issues/KAN-2/work-sessions/heartbeat");
    expect(registry.getSnapshot().entries["KAN-1"]?.status).toBe("passive");
    expect(registry.getSnapshot().entries["KAN-2"]?.status).toBe("owned");
  });

  it("retries network/503 failures with byte-identical commands and bounded exponential backoff", async () => {
    vi.useFakeTimers();
    const { registry, request } = harness(vi.fn());
    await hydrateOne(registry, request);
    request
      .mockRejectedValueOnce(new ApiError(503, "UNAVAILABLE", "later"))
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(response(commandIds[0]!));

    const claim = registry.recordActivity("KAN-1");
    await flushMicrotasks();
    const firstBody = request.mock.calls[1]?.[2]?.body;
    expect(registry.getSnapshot().entries["KAN-1"]?.status).toBe("retrying-claim");
    await vi.advanceTimersByTimeAsync(99);
    expect(request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(request.mock.calls[2]?.[2]?.body).toBe(firstBody);
    await vi.advanceTimersByTimeAsync(200);
    await claim;

    expect(request.mock.calls[3]?.[2]?.body).toBe(firstBody);
    expect(registry.getSnapshot().entries["KAN-1"]?.status).toBe("owned");
  });

  it("serializes each issue while allowing different issues to progress concurrently", async () => {
    const a = deferred<unknown>();
    const b = deferred<unknown>();
    const request = vi.fn().mockResolvedValueOnce(
      page(scopeA, [
        { issueKey: "KAN-1", epoch: epoch1, leaseGeneration: 1 },
        { issueKey: "KAN-2", epoch: epoch2, leaseGeneration: 1 },
      ])
    );
    const { registry } = harness(request);
    await registry.activateScope(scopeA);
    request.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);

    const one = registry.recordActivity("KAN-1");
    const duplicate = registry.recordActivity("KAN-1");
    const two = registry.recordActivity("KAN-2");
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3));

    a.resolve(response(commandIds[0]!));
    b.resolve({
      ...response(commandIds[1]!),
      captureIntent: { epoch: epoch2, leaseGeneration: 1, state: "capturing" },
    });
    await Promise.all([one, duplicate, two]);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("creates a release obligation after either 200 or durable 202 acceptance and stops HTTP retry", async () => {
    for (const deliveryStatus of ["acknowledged", "pending"] as const) {
      const { registry, request, store } = harness(vi.fn());
      await hydrateOne(registry, request);
      request.mockResolvedValueOnce(response(commandIds[0]!, deliveryStatus));
      await registry.recordActivity("KAN-1");

      expect(registry.getSnapshot().entries["KAN-1"]?.status).toBe(
        deliveryStatus === "pending" ? "claim-accepted" : "owned"
      );
      expect(await store.listObligations(scopeA)).toHaveLength(1);
      expect(request).toHaveBeenCalledTimes(2);
    }
  });

  it("releases old owned entries on a scope switch but never releases passive entries", async () => {
    const { registry, request } = harness(vi.fn());
    await hydrateOne(registry, request);
    request.mockResolvedValueOnce(response(commandIds[0]!));
    await registry.recordActivity("KAN-1");
    request.mockResolvedValueOnce(response(commandIds[1]!));
    request.mockResolvedValueOnce(page(scopeB, []));

    await registry.activateScope(scopeB);

    const release = request.mock.calls.find(([path]) =>
      String(path).endsWith("/work-captures/release")
    );
    expect(release?.[0]).toBe("/api/issues/KAN-1/work-captures/release");
    expect(registry.getSnapshot().scope).toEqual(scopeB);
  });

  it("records a release after logout when an in-flight claim is accepted late", async () => {
    const accepted = deferred<unknown>();
    const { registry, request } = harness(vi.fn());
    await hydrateOne(registry, request);
    request.mockReturnValueOnce(accepted.promise).mockResolvedValueOnce(response(commandIds[1]!));

    const claim = registry.recordActivity("KAN-1");
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    await registry.releaseScope(scopeA, { keepalive: false });
    accepted.resolve(response(commandIds[0]!));
    await claim;

    expect(request.mock.calls[2]?.[0]).toBe("/api/issues/KAN-1/work-captures/release");
  });

  it("releases a same-profile obligation recorded by another live tab", async () => {
    const { registry, request, store } = harness(vi.fn());
    await hydrateOne(registry, request);
    await store.putObligation({
      scope: scopeA,
      issueKey: "KAN-1",
      epoch: epoch1,
      leaseGeneration: 1,
      acceptance: "acknowledged",
    });
    request.mockResolvedValueOnce(response(commandIds[0]!));

    await registry.releaseScope(scopeA, { keepalive: false });

    expect(request.mock.calls[1]?.[0]).toBe("/api/issues/KAN-1/work-captures/release");
  });

  it("rehydrates and can reclaim the same scope after it was released", async () => {
    const { registry, request } = harness(vi.fn());
    await hydrateOne(registry, request);
    request.mockResolvedValueOnce(response(commandIds[0]!));
    await registry.recordActivity("KAN-1");
    request.mockResolvedValueOnce(response(commandIds[1]!));
    await registry.releaseScope(scopeA, { keepalive: false });

    request.mockResolvedValueOnce(
      page(scopeA, [{ issueKey: "KAN-1", epoch: epoch1, leaseGeneration: 1 }])
    );
    await registry.activateScope(scopeA);
    request.mockResolvedValueOnce(response(commandIds[2]!));
    await registry.recordActivity("KAN-1");

    expect(request.mock.calls[3]?.[0]).toContain("/api/me/work-captures?");
    expect(request.mock.calls[4]?.[0]).toBe("/api/issues/KAN-1/work-sessions/heartbeat");
    expect(registry.getSnapshot().entries["KAN-1"]?.status).toBe("owned");
  });

  it("reconciles only current well-formed work-session events and ignores intent requests", async () => {
    const { registry, request } = harness(vi.fn());
    await hydrateOne(registry, request);
    request.mockResolvedValueOnce(response(commandIds[0]!, "pending"));
    await registry.recordActivity("KAN-1");

    registry.reconcileDomainEvent({
      type: "work_capture.intent_effect_requested",
      workspaceId: scopeA.workspaceId,
      payload: { issueKey: "KAN-1", userId: scopeA.principalId },
    });
    expect(registry.getSnapshot().entries["KAN-1"]?.status).toBe("claim-accepted");

    registry.reconcileDomainEvent({
      type: "work_session.started",
      workspaceId: scopeB.workspaceId,
      payload: { issueKey: "KAN-1", userId: scopeA.principalId },
    });
    expect(registry.getSnapshot().entries["KAN-1"]?.status).toBe("claim-accepted");

    registry.reconcileDomainEvent({
      type: "work_session.started",
      workspaceId: scopeA.workspaceId,
      payload: {},
    });
    expect(registry.getSnapshot().entries["KAN-1"]?.status).toBe("claim-accepted");

    registry.reconcileDomainEvent({
      type: "work_session.started",
      workspaceId: scopeA.workspaceId,
      payload: {
        issueKey: "KAN-1",
        userId: scopeA.principalId,
        captureIntent: { epoch: epoch1, leaseGeneration: 2 },
      },
    });
    expect(registry.getSnapshot().entries["KAN-1"]).toMatchObject({
      status: "owned",
      epoch: epoch1,
      leaseGeneration: 2,
    });

    request.mockImplementationOnce(async (_path, _schema, init: RequestInit) => {
      expect(JSON.parse(String(init.body))).toMatchObject({ epoch: epoch1, leaseGeneration: 2 });
      return {
        ...response(commandIds[1]!),
        captureIntent: { epoch: epoch1, leaseGeneration: 2, state: "capturing" as const },
      };
    });
    await registry.recordActivity("KAN-1");
  });

  it("keeps an expired server intent resumable and still deletes an authoritative close", async () => {
    const { registry, request, store } = harness(vi.fn());
    await hydrateOne(registry, request);
    request.mockResolvedValueOnce(response(commandIds[0]!));
    await registry.recordActivity("KAN-1");

    registry.reconcileDomainEvent({
      type: "work_session.ended",
      workspaceId: scopeA.workspaceId,
      payload: {
        issueKey: "KAN-1",
        userId: scopeA.principalId,
        reason: "expired",
        captureIntent: { epoch: epoch1, leaseGeneration: 1 },
      },
    });
    await flushMicrotasks();

    expect(registry.getSnapshot().entries["KAN-1"]).toMatchObject({
      status: "passive",
      epoch: epoch1,
      leaseGeneration: 1,
    });
    expect(await store.listObligations(scopeA)).toEqual([]);

    request.mockImplementationOnce(async (_path, _schema, init: RequestInit) => {
      expect(JSON.parse(String(init.body))).toMatchObject({
        epoch: epoch1,
        leaseGeneration: 1,
      });
      return response(commandIds[1]!);
    });
    await registry.recordActivity("KAN-1");
    expect(request).toHaveBeenCalledTimes(3);

    registry.reconcileDomainEvent({
      type: "work_session.ended",
      workspaceId: scopeA.workspaceId,
      payload: {
        issueKey: "KAN-1",
        userId: scopeA.principalId,
        reason: "stopped",
      },
    });
    await flushMicrotasks();

    expect(registry.getSnapshot().entries["KAN-1"]).toBeUndefined();
    expect(await store.listObligations(scopeA)).toEqual([]);
  });

  it("uses exact returned keys for single, group, and batch transition adapters", async () => {
    const { registry, request } = harness(vi.fn());
    request.mockResolvedValueOnce(
      page(scopeA, [
        { issueKey: "KAN-1", epoch: epoch1, leaseGeneration: 1 },
        { issueKey: "KAN-2", epoch: epoch2, leaseGeneration: 1 },
      ])
    );
    await registry.activateScope(scopeA);
    const activity = vi.spyOn(registry, "recordActivity").mockResolvedValue();

    registry.recordTransitionResult({ key: "KAN-2" });
    registry.recordTransitionResult({ key: 123 });
    registry.recordBatchTransitionResult({ keys: ["KAN-1", "KAN-2", null] });

    expect(activity.mock.calls.map(([key]) => key)).toEqual(["KAN-2", "KAN-1", "KAN-2"]);
  });
});

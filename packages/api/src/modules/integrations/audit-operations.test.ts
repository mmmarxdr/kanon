import { describe, expect, it, vi } from "vitest";
import {
  createRedmineAuditSourceForLease,
  runAuditOperationsCycle,
  type AuditOperationsDependencies,
} from "./audit-operations.js";
import {
  releaseBindingPollLease,
  renewBindingPollLease,
  type ClaimedBinding,
} from "./inbound.js";

const lease: ClaimedBinding = {
  id: "binding-1",
  connectionId: "connection-1",
  projectId: "project-1",
  remoteProjectId: "42",
  readMap: {},
  lifecycleEpoch: 2,
  cursorUpdatedAt: null,
  cursorRemoteId: null,
  bootstrapCutoff: new Date("2026-08-14T12:00:00Z"),
  pollLeaseToken: "lease-1",
  pollFence: 7,
  baseUrl: "https://redmine.internal",
  encryptedKey: "ciphertext",
  credentialId: "credential-1",
  credentialLastValidatedAt: new Date("2026-08-14T12:00:00Z"),
  actorMemberId: "member-1",
};

const options = {
  maxBindings: 1,
  leaseMs: 10_000,
  timeoutMs: 30_000,
  pageSize: 100,
  maxPasses: 2,
  terminalFreshnessMs: 300_000,
  retentionDays: 30,
};

function dependencies(overrides: Partial<AuditOperationsDependencies> = {}) {
  const repository = {
    persistence: vi.fn(() => ({ id: "persistence" })),
    markFailed: vi.fn().mockResolvedValue(true),
  };
  const defaults: AuditOperationsDependencies = {
    now: () => new Date("2026-08-14T12:00:00Z"),
    decrypt: vi.fn(() => "api-key"),
    claim: vi.fn().mockResolvedValueOnce(lease).mockResolvedValue(null),
    renew: vi.fn().mockResolvedValue(true),
    release: vi.fn().mockResolvedValue(true),
    createSource: vi.fn(() => ({ id: "source" }) as never),
    createRepository: vi.fn(() => repository as never),
    runCensus: vi.fn().mockResolvedValue({
      kind: "complete-current-visible",
      scopeFingerprint: "scope",
    }),
  };
  return { repository, result: { ...defaults, ...overrides } };
}

describe("audit lease operations", () => {
  it("renews and releases only the exact held token and fence", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const database = { integrationProjectBinding: { updateMany } } as never;
    const renewedUntil = new Date("2026-08-14T12:00:10Z");

    await expect(renewBindingPollLease(database, lease, renewedUntil)).resolves.toBe(true);
    await expect(releaseBindingPollLease(database, lease)).resolves.toBe(true);

    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: lease.id,
        lifecycle: "active",
        inboundEnabled: true,
        bootstrapState: "ready",
        lifecycleEpoch: lease.lifecycleEpoch,
        pollLeaseToken: lease.pollLeaseToken,
        pollFence: lease.pollFence,
        connection: { lifecycle: "active" },
      },
      data: { pollLeaseUntil: renewedUntil },
    });
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: lease.id, pollLeaseToken: lease.pollLeaseToken, pollFence: lease.pollFence },
      data: { pollLeaseToken: null, pollLeaseUntil: null },
    });
  });

  it("claims no more than the strict maximum and applies sequential backpressure", async () => {
    const secondLease = { ...lease, id: "binding-2", pollLeaseToken: "lease-2", pollFence: 8 };
    const claim = vi.fn().mockResolvedValueOnce(lease).mockResolvedValueOnce(secondLease);
    const releases: Array<() => void> = [];
    let active = 0;
    const runCensus = vi.fn(async () => {
      active += 1;
      expect(active).toBe(1);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return { kind: "complete-current-visible" as const, scopeFingerprint: "scope" };
    });
    const setup = dependencies({ claim, runCensus });
    const pending = runAuditOperationsCycle({} as never, { ...options, maxBindings: 2 }, setup.result);

    await vi.waitFor(() => expect(runCensus).toHaveBeenCalledTimes(1));
    expect(claim).toHaveBeenCalledTimes(1);
    releases.shift()!();
    await vi.waitFor(() => expect(runCensus).toHaveBeenCalledTimes(2));
    releases.shift()!();

    await expect(pending).resolves.toEqual({ claimed: 2, completed: 2 });
    expect(claim).toHaveBeenCalledTimes(2);
  });

  it("renews the same fence while census work is pending and releases after finalization", async () => {
    vi.useFakeTimers();
    try {
      let finish!: () => void;
      const runCensus = vi.fn(async () => {
        await new Promise<void>((resolve) => { finish = resolve; });
        return { kind: "complete-current-visible" as const, scopeFingerprint: "scope" };
      });
      const setup = dependencies({ runCensus });
      const pending = runAuditOperationsCycle({} as never, options, setup.result);
      await vi.advanceTimersByTimeAsync(options.leaseMs / 2);

      expect(setup.result.renew).toHaveBeenCalledWith(
        expect.anything(),
        lease,
        new Date("2026-08-14T12:00:10Z"),
      );
      finish();
      await expect(pending).resolves.toEqual({ claimed: 1, completed: 1 });
      expect(setup.result.release).toHaveBeenCalledWith(expect.anything(), lease);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["deadline", "fence loss"])("cancels provider work on %s and still releases", async (cause) => {
    vi.useFakeTimers();
    try {
      const renew = vi.fn().mockResolvedValue(cause === "fence loss" ? false : true);
      const runCensus = vi.fn(async (_source, _persistence, _lease, censusOptions) => {
        await new Promise<void>((resolve) => censusOptions.signal.addEventListener("abort", () => resolve(), { once: true }));
        return { kind: "unknown" as const, reasonCode: cause === "deadline" ? "timeout" as const : "scope_or_fence_changed" as const };
      });
      const setup = dependencies({ renew, runCensus });
      const pending = runAuditOperationsCycle({} as never, options, setup.result);
      await vi.advanceTimersByTimeAsync(cause === "deadline" ? options.timeoutMs : options.leaseMs / 2);

      await expect(pending).resolves.toEqual({ claimed: 1, completed: 0 });
      expect(setup.result.release).toHaveBeenCalledWith(expect.anything(), lease);
      if (cause === "deadline") expect(setup.repository.markFailed).not.toHaveBeenCalled();
      else expect(setup.repository.markFailed).toHaveBeenCalledWith(
        expect.objectContaining({ id: lease.id, pollLeaseToken: lease.pollLeaseToken, pollFence: lease.pollFence }),
        "scope_or_fence_changed",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the durable partial run resumable after a time-bounded census", async () => {
    const setup = dependencies({ runCensus: vi.fn().mockResolvedValue({ kind: "unknown", reasonCode: "timeout" }) });

    await expect(runAuditOperationsCycle({} as never, options, setup.result)).resolves.toEqual({ claimed: 1, completed: 0 });
    expect(setup.repository.markFailed).not.toHaveBeenCalled();
    expect(setup.repository.persistence).toHaveBeenCalledOnce();
  });

  it("constructs the production Redmine client with the endpoint allowlist", () => {
    const allowlist = { "https://redmine.internal": ["10.0.0.8"] };
    const source = createRedmineAuditSourceForLease(lease, "api-key", allowlist);
    const client = (source as unknown as { client: { options: { endpointAllowlist?: unknown } } }).client;

    expect(client.options.endpointAllowlist).toBe(allowlist);
  });
});

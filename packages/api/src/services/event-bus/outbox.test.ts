import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config/prisma.js", () => ({
  prisma: {
    domainEventOutbox: {
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("./index.js", () => ({
  eventBus: { emitAndWait: vi.fn() },
}));

import { prisma } from "../../config/prisma.js";
import { eventBus } from "./index.js";
import {
  claimDueDomainEvents,
  deliverClaimedDomainEvent,
  drainDomainEventOutbox,
  enqueueDomainEventTx,
  startDomainEventOutboxRecovery,
} from "./outbox.js";

const mockUpsert = vi.mocked(prisma.domainEventOutbox.upsert);
const mockUpdateMany = vi.mocked(prisma.domainEventOutbox.updateMany);
const mockTransaction = vi.mocked(prisma.$transaction);
const mockEmitAndWait = vi.mocked(eventBus.emitAndWait);

const input = {
  deliveryKey: "work-session.started:v1:session-1",
  laneKey: "work-session:session-1",
  event: {
    type: "work_session.started" as const,
    workspaceId: "00000000-0000-4000-8000-000000000001",
    actorId: "00000000-0000-4000-8000-000000000002",
    payload: { issueId: "issue-1" },
  },
};

const claimed = {
  id: "00000000-0000-4000-8000-000000000010",
  deliveryKey: input.deliveryKey,
  laneKey: input.laneKey,
  eventType: input.event.type,
  workspaceId: input.event.workspaceId,
  actorId: input.event.actorId,
  payload: input.event.payload,
  claimToken: "00000000-0000-4000-8000-000000000011",
  attempts: 1,
};

describe("DomainEventOutbox", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockUpsert.mockResolvedValue({
      id: claimed.id,
      deliveryKey: claimed.deliveryKey,
    } as never);
    mockUpdateMany.mockResolvedValue({ count: 1 } as never);
    mockEmitAndWait.mockResolvedValue(undefined);
  });

  it("idempotently enqueues one immutable event by semantic delivery key", async () => {
    const tx = { domainEventOutbox: { upsert: mockUpsert } } as never;

    await enqueueDomainEventTx(tx, input);
    await enqueueDomainEventTx(tx, input);

    expect(mockUpsert).toHaveBeenNthCalledWith(1, {
      where: { deliveryKey: input.deliveryKey },
      update: {},
      create: {
        deliveryKey: input.deliveryKey,
        laneKey: input.laneKey,
        eventType: input.event.type,
        workspaceId: input.event.workspaceId,
        actorId: input.event.actorId,
        payload: input.event.payload,
      },
      select: { id: true, deliveryKey: true },
    });
    expect(mockUpsert).toHaveBeenCalledTimes(2);
  });

  it("claims due lane heads atomically with database time and SKIP LOCKED", async () => {
    const queryRaw = vi.fn().mockResolvedValue([claimed]);
    mockTransaction.mockImplementation(async (operation: any) =>
      operation({ $queryRaw: queryRaw })
    );

    await expect(claimDueDomainEvents(20)).resolves.toEqual([claimed]);

    const sql = queryRaw.mock.calls[0]![0].join(" ");
    expect(sql).toContain("CURRENT_TIMESTAMP");
    expect(sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(sql).toContain("NOT EXISTS");
    expect(sql).toContain("lane_key");
    expect(sql).toContain("position");
  });

  it("keeps a failed first delivery pending with bounded retry backoff", async () => {
    mockEmitAndWait.mockRejectedValueOnce(new Error("subscriber unavailable"));

    await expect(deliverClaimedDomainEvent(claimed)).rejects.toThrow("subscriber unavailable");

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: {
        id: claimed.id,
        claimToken: claimed.claimToken,
        acknowledgedAt: null,
      },
      data: {
        claimToken: null,
        claimedAt: null,
        availableAt: expect.any(Date),
        lastError: "subscriber unavailable",
      },
    });
    const retryAt = mockUpdateMany.mock.calls[0]![0].data.availableAt as Date;
    expect(retryAt.getTime() - Date.now()).toBeGreaterThanOrEqual(900);
    expect(retryAt.getTime() - Date.now()).toBeLessThanOrEqual(30_000);
  });

  it("reuses the same stable delivery key after failure and acknowledges it once", async () => {
    mockEmitAndWait
      .mockRejectedValueOnce(new Error("first attempt failed"))
      .mockResolvedValueOnce(undefined);

    await expect(deliverClaimedDomainEvent(claimed)).rejects.toThrow();
    await expect(deliverClaimedDomainEvent({ ...claimed, attempts: 2 })).resolves.toBeUndefined();

    expect(mockEmitAndWait).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ deliveryKey: claimed.deliveryKey })
    );
    expect(mockEmitAndWait).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ deliveryKey: claimed.deliveryKey })
    );
    expect(mockUpdateMany).toHaveBeenLastCalledWith({
      where: {
        id: claimed.id,
        claimToken: claimed.claimToken,
        acknowledgedAt: null,
      },
      data: {
        acknowledgedAt: expect.any(Date),
        claimToken: null,
        claimedAt: null,
        lastError: null,
      },
    });
  });

  it("fences a stale claimant acknowledgement by lease token", async () => {
    mockUpdateMany.mockResolvedValueOnce({ count: 0 } as never);

    await expect(deliverClaimedDomainEvent(claimed)).resolves.toBeUndefined();

    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ claimToken: claimed.claimToken }),
      })
    );
  });

  it("uses the same delivery key when a crash occurs after emit but before ack", async () => {
    mockUpdateMany.mockRejectedValueOnce(new Error("database disconnected"));

    await expect(deliverClaimedDomainEvent(claimed)).rejects.toThrow("database disconnected");

    expect(mockEmitAndWait).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryKey: claimed.deliveryKey })
    );
  });

  it("drains a claimed batch and isolates one failed lane", async () => {
    const other = {
      ...claimed,
      id: "00000000-0000-4000-8000-000000000012",
      deliveryKey: "work-session.started:v1:session-2",
      laneKey: "work-session:session-2",
      claimToken: "00000000-0000-4000-8000-000000000013",
    };
    const queryRaw = vi.fn().mockResolvedValueOnce([claimed, other]).mockResolvedValueOnce([]);
    mockTransaction.mockImplementation(async (operation: any) =>
      operation({ $queryRaw: queryRaw })
    );
    mockEmitAndWait
      .mockRejectedValueOnce(new Error("lane one failed"))
      .mockResolvedValueOnce(undefined);
    const logger = { error: vi.fn() };

    await expect(drainDomainEventOutbox(logger)).resolves.toBe(1);

    expect(mockEmitAndWait).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it("runs a startup drain, schedules non-overlapping retries, and cancels on stop", async () => {
    vi.useFakeTimers();
    const first = Promise.withResolvers<number>();
    const drain = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(0);
    const recovery = startDomainEventOutboxRecovery({
      drain,
      intervalMs: 100,
      logger: { error: vi.fn() },
    });

    expect(drain).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(200);
    expect(drain).toHaveBeenCalledOnce();

    first.resolve(1);
    await first.promise;
    await vi.advanceTimersByTimeAsync(100);
    expect(drain).toHaveBeenCalledTimes(2);

    await recovery.stop();
    await vi.advanceTimersByTimeAsync(500);
    expect(drain).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("lets the active delivery settle but stops recovery before another row", async () => {
    const other = {
      ...claimed,
      id: "00000000-0000-4000-8000-000000000012",
      deliveryKey: "work-session.started:v1:session-2",
      laneKey: "work-session:session-2",
      claimToken: "00000000-0000-4000-8000-000000000013",
    };
    const queryRaw = vi.fn().mockResolvedValueOnce([claimed, other]).mockResolvedValueOnce([]);
    mockTransaction.mockImplementation(async (operation: any) =>
      operation({ $queryRaw: queryRaw })
    );
    const activeDelivery = Promise.withResolvers<void>();
    mockEmitAndWait.mockReturnValueOnce(activeDelivery.promise).mockResolvedValue(undefined);
    const recovery = startDomainEventOutboxRecovery({
      logger: { error: vi.fn() },
    });

    await vi.waitFor(() => expect(mockEmitAndWait).toHaveBeenCalledOnce());
    let stopped = false;
    const stop = recovery.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);

    activeDelivery.resolve();
    await stop;

    expect(mockEmitAndWait).toHaveBeenCalledOnce();
    expect(queryRaw).toHaveBeenCalledOnce();
  });
});

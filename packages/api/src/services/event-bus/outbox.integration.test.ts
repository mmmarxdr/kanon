import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma.js";
import { cleanDatabase, disconnectTestDb } from "../../test/helpers.js";
import { claimDueDomainEvents, deliverClaimedDomainEvent, enqueueDomainEventTx } from "./outbox.js";

function eventInput(deliveryKey: string, laneKey: string) {
  return {
    deliveryKey,
    laneKey,
    event: {
      type: "work_session.started" as const,
      workspaceId: randomUUID(),
      actorId: randomUUID(),
      payload: { deliveryKey },
    },
  };
}

describe("DomainEventOutbox database claims", () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await disconnectTestDb();
  });

  it("never claims a later event while the lane head is pending", async () => {
    const laneKey = `lane:${randomUUID()}`;
    await prisma.$transaction(async (tx) => {
      await enqueueDomainEventTx(tx, eventInput("lane-head", laneKey));
      await enqueueDomainEventTx(tx, eventInput("lane-tail", laneKey));
    });

    const first = await claimDueDomainEvents(10);
    expect(first.map((row) => row.deliveryKey)).toEqual(["lane-head"]);
    await deliverClaimedDomainEvent(first[0]!);

    const second = await claimDueDomainEvents(10);
    expect(second.map((row) => row.deliveryKey)).toEqual(["lane-tail"]);
  });

  it("claims independent lanes concurrently and fences an expired lease token", async () => {
    await prisma.$transaction(async (tx) => {
      await enqueueDomainEventTx(tx, eventInput("concurrent-a", `lane:${randomUUID()}`));
      await enqueueDomainEventTx(tx, eventInput("concurrent-b", `lane:${randomUUID()}`));
    });

    const [claimA, claimB] = await Promise.all([claimDueDomainEvents(1), claimDueDomainEvents(1)]);
    expect(new Set([claimA[0]?.deliveryKey, claimB[0]?.deliveryKey])).toEqual(
      new Set(["concurrent-a", "concurrent-b"])
    );

    const stale = claimA[0]!;
    await prisma.domainEventOutbox.update({
      where: { id: stale.id },
      data: { claimedAt: new Date(0) },
    });
    const [replacement] = await claimDueDomainEvents(1, [stale.deliveryKey]);
    expect(replacement?.claimToken).not.toBe(stale.claimToken);

    await deliverClaimedDomainEvent(stale);
    expect(await prisma.domainEventOutbox.findUnique({ where: { id: stale.id } })).toMatchObject({
      acknowledgedAt: null,
      claimToken: replacement?.claimToken,
    });

    await deliverClaimedDomainEvent(replacement!);
    expect(await prisma.domainEventOutbox.findUnique({ where: { id: stale.id } })).toMatchObject({
      acknowledgedAt: expect.any(Date),
      claimToken: null,
    });
  });
});

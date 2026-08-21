import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { eventBus } from "./index.js";
import type { DomainEventInput, DomainEventType } from "./types.js";

export const DOMAIN_EVENT_OUTBOX_RECOVERY_INTERVAL_MS = 30_000;
const DOMAIN_EVENT_OUTBOX_LEASE_MS = 30_000;
const DOMAIN_EVENT_OUTBOX_BATCH_SIZE = 25;
const DOMAIN_EVENT_OUTBOX_MAX_BATCHES = 100;
const DOMAIN_EVENT_OUTBOX_RETRY_BASE_MS = 1_000;
const DOMAIN_EVENT_OUTBOX_RETRY_MAX_MS = 30_000;
const DOMAIN_EVENT_OUTBOX_LAST_ERROR_MAX_LENGTH = 2_000;

export interface DomainEventOutboxLogger {
  error(obj: unknown, msg?: string): void;
}

export interface EnqueueDomainEventInput {
  deliveryKey: string;
  laneKey: string;
  event: DomainEventInput;
}

export interface ClaimedDomainEvent {
  id: string;
  deliveryKey: string;
  laneKey: string;
  eventType: string;
  workspaceId: string;
  actorId: string;
  payload: Prisma.JsonValue;
  claimToken: string;
  attempts: number;
}

export async function enqueueDomainEventTx(
  tx: Prisma.TransactionClient,
  input: EnqueueDomainEventInput
): Promise<{ id: string; deliveryKey: string }> {
  return tx.domainEventOutbox.upsert({
    where: { deliveryKey: input.deliveryKey },
    update: {},
    create: {
      deliveryKey: input.deliveryKey,
      laneKey: input.laneKey,
      eventType: input.event.type,
      workspaceId: input.event.workspaceId,
      actorId: input.event.actorId,
      payload: input.event.payload as Prisma.InputJsonValue,
    },
    select: { id: true, deliveryKey: true },
  });
}

/**
 * Claim only due lane heads. Database time decides lease expiry and due-ness so
 * workers with skewed process clocks cannot steal or indefinitely retain work.
 */
export async function claimDueDomainEvents(
  limit: number = DOMAIN_EVENT_OUTBOX_BATCH_SIZE,
  deliveryKeys?: readonly string[],
  laneKey?: string
): Promise<ClaimedDomainEvent[]> {
  if (deliveryKeys?.length === 0) return [];
  const deliveryFilter = deliveryKeys
    ? Prisma.sql`AND candidate_row."delivery_key" IN (${Prisma.join(deliveryKeys)})`
    : Prisma.empty;
  const laneFilter = laneKey ? Prisma.sql`AND candidate_row."lane_key" = ${laneKey}` : Prisma.empty;

  return prisma.$transaction(
    (tx) =>
      tx.$queryRaw<ClaimedDomainEvent[]>`
      WITH due AS (
        SELECT candidate_row."id"
        FROM "domain_event_outbox" candidate_row
        WHERE candidate_row."acknowledged_at" IS NULL
          AND candidate_row."available_at" <= CURRENT_TIMESTAMP
          AND (
            candidate_row."claim_token" IS NULL
            OR candidate_row."claimed_at" <
              CURRENT_TIMESTAMP - (${DOMAIN_EVENT_OUTBOX_LEASE_MS} * INTERVAL '1 millisecond')
          )
          ${deliveryFilter}
          ${laneFilter}
          AND NOT EXISTS (
            SELECT 1
            FROM "domain_event_outbox" earlier
            WHERE earlier."lane_key" = candidate_row."lane_key"
              AND earlier."position" < candidate_row."position"
              AND earlier."acknowledged_at" IS NULL
          )
        ORDER BY candidate_row."position" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      UPDATE "domain_event_outbox" claimed
      SET
        "claim_token" = gen_random_uuid(),
        "claimed_at" = CURRENT_TIMESTAMP,
        "attempts" = claimed."attempts" + 1,
        "updated_at" = CURRENT_TIMESTAMP
      FROM due
      WHERE claimed."id" = due."id"
      RETURNING
        claimed."id",
        claimed."delivery_key" AS "deliveryKey",
        claimed."lane_key" AS "laneKey",
        claimed."event_type" AS "eventType",
        claimed."workspace_id" AS "workspaceId",
        claimed."actor_id" AS "actorId",
        claimed."payload",
        claimed."claim_token" AS "claimToken",
        claimed."attempts"
    `
  );
}

function retryDelayMs(attempts: number): number {
  const exponent = Math.max(0, Math.min(attempts - 1, 30));
  return Math.min(
    DOMAIN_EVENT_OUTBOX_RETRY_MAX_MS,
    DOMAIN_EVENT_OUTBOX_RETRY_BASE_MS * 2 ** exponent
  );
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, DOMAIN_EVENT_OUTBOX_LAST_ERROR_MAX_LENGTH);
}

/** Deliver one leased row and acknowledge only if this worker still owns it. */
export async function deliverClaimedDomainEvent(row: ClaimedDomainEvent): Promise<void> {
  try {
    await eventBus.emitAndWait({
      type: row.eventType as DomainEventType,
      workspaceId: row.workspaceId,
      actorId: row.actorId,
      payload: row.payload as Record<string, unknown>,
      deliveryKey: row.deliveryKey,
    });
  } catch (error) {
    await prisma.domainEventOutbox.updateMany({
      where: {
        id: row.id,
        claimToken: row.claimToken,
        acknowledgedAt: null,
      },
      data: {
        claimToken: null,
        claimedAt: null,
        availableAt: new Date(Date.now() + retryDelayMs(row.attempts)),
        lastError: errorMessage(error),
      },
    });
    throw error;
  }

  await prisma.domainEventOutbox.updateMany({
    where: {
      id: row.id,
      claimToken: row.claimToken,
      acknowledgedAt: null,
    },
    data: {
      acknowledgedAt: new Date(),
      claimToken: null,
      claimedAt: null,
      lastError: null,
    },
  });
}

/** Claim and synchronously publish a known semantic key after its transaction. */
export async function publishDomainEventByDeliveryKey(deliveryKey: string): Promise<boolean> {
  const [claimed] = await claimDueDomainEvents(1, [deliveryKey]);
  if (!claimed) return false;
  await deliverClaimedDomainEvent(claimed);
  return true;
}

/** Publish due events from one lane in persisted order. */
export async function publishDomainEventLane(laneKey: string): Promise<number> {
  let delivered = 0;
  for (let batch = 0; batch < DOMAIN_EVENT_OUTBOX_MAX_BATCHES; batch++) {
    const [claimed] = await claimDueDomainEvents(1, undefined, laneKey);
    if (!claimed) break;
    await deliverClaimedDomainEvent(claimed);
    delivered++;
  }
  return delivered;
}

/** Drain currently due lane heads. Failed lanes are rescheduled independently. */
export async function drainDomainEventOutbox(
  logger: DomainEventOutboxLogger = console,
  options: { signal?: AbortSignal } = {}
): Promise<number> {
  let delivered = 0;
  for (let batch = 0; batch < DOMAIN_EVENT_OUTBOX_MAX_BATCHES; batch++) {
    if (options.signal?.aborted) break;
    const claimed = await claimDueDomainEvents();
    if (claimed.length === 0) break;

    for (const row of claimed) {
      if (options.signal?.aborted) break;
      try {
        await deliverClaimedDomainEvent(row);
        delivered++;
      } catch (err) {
        logger.error({ err, deliveryKey: row.deliveryKey }, "domain-event outbox delivery failed");
      }
    }
  }
  return delivered;
}

export interface DomainEventOutboxRecovery {
  stop(): Promise<void>;
}

/** Start an immediate, self-rescheduling, non-overlapping recovery loop. */
export function startDomainEventOutboxRecovery(
  options: {
    drain?: (signal: AbortSignal) => Promise<number>;
    intervalMs?: number;
    logger?: DomainEventOutboxLogger;
  } = {}
): DomainEventOutboxRecovery {
  const logger = options.logger ?? console;
  const abortController = new AbortController();
  const drain =
    options.drain ?? ((signal: AbortSignal) => drainDomainEventOutbox(logger, { signal }));
  const intervalMs = options.intervalMs ?? DOMAIN_EVENT_OUTBOX_RECOVERY_INTERVAL_MS;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;

  const schedule = (): void => {
    if (stopped) return;
    timer = setTimeout(run, intervalMs);
    timer.unref?.();
  };

  const run = (): void => {
    if (stopped || running) return;
    let delivery: Promise<number>;
    try {
      delivery = Promise.resolve(drain(abortController.signal));
    } catch (err) {
      delivery = Promise.reject(err);
    }
    const current = delivery
      .then(() => undefined)
      .catch((err: unknown) => {
        logger.error({ err }, "domain-event outbox recovery failed");
      })
      .finally(() => {
        if (running === current) running = undefined;
        schedule();
      });
    running = current;
  };

  run();

  return {
    async stop(): Promise<void> {
      stopped = true;
      // Cooperative cancellation is checked only between deliveries/batches:
      // an already-dispatched event settles before shutdown returns.
      abortController.abort();
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      await running;
    },
  };
}

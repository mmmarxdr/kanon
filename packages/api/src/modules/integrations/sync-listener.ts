import { env } from "../../config/env.js";
import type { IEventBus } from "../../services/event-bus/interface.js";
import type { DomainEvent } from "../../services/event-bus/types.js";
import { ISSUE_CAPTURE_FIELDS } from "./issue-mutation-contract.js";

const ISSUE_FIELDS = new Set<string>(ISSUE_CAPTURE_FIELDS);

export interface IntegrationSyncListenerLogger {
  error(context: unknown, message?: string): void;
}

function eventEntityKey(event: DomainEvent): string | null {
  const payload = event.payload as Record<string, unknown>;
  const id = (field: string) => {
    const value = payload[field];
    return typeof value === "string" && value.length > 0 ? value : null;
  };
  const issueId = id("issueId");

  switch (event.type) {
    case "issue.updated": {
      const fields = payload["fields"];
      return Array.isArray(fields) && fields.some((field) => ISSUE_FIELDS.has(field))
        ? issueId && `issue:${issueId}`
        : null;
    }
    case "issue.transitioned":
    case "issue.deleted":
    case "schedule.updated":
    case "estimate.revised":
      return issueId && `issue:${issueId}`;
    case "cycle.closed": {
      const cycleId = id("cycleId");
      return cycleId && `cycle:${cycleId}`;
    }
    default:
      return null;
  }
}

export function registerIntegrationSyncListener(
  bus: IEventBus,
  wake: () => Promise<unknown>,
  logger: IntegrationSyncListenerLogger = console,
  debounceMs = env.INTEGRATION_SYNC_DEBOUNCE_MS
): () => Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | undefined;
  let pending = false;
  let lastEntityKey = "unknown";
  let active = true;

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      if (inFlight) {
        pending = true;
        return;
      }
      const current = Promise.resolve()
        .then(wake)
        .catch((error: unknown) => {
          try {
            logger.error({ error, entityKey: lastEntityKey }, "Integration work wake-up failed");
          } catch {
            // Error reporting must not affect wake-up lifecycle.
          }
        })
        .then(() => undefined)
        .finally(() => {
          if (inFlight === current) inFlight = undefined;
          if (active && pending) {
            pending = false;
            schedule();
          }
        });
      inFlight = current;
    }, debounceMs);
    timer.unref?.();
  };

  const unsubscribe = bus.subscribe((event) => {
    const entityKey = eventEntityKey(event);
    if (!active || !entityKey) return;
    lastEntityKey = entityKey;
    schedule();
  }, "integration-sync-listener");

  return () => {
    active = false;
    pending = false;
    unsubscribe();
    if (timer) clearTimeout(timer);
    timer = undefined;
    return inFlight ?? Promise.resolve();
  };
}

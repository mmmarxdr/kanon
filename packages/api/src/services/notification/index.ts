/**
 * NotificationService — S3 / KAN-27
 *
 * Subscribes to the in-process EventBus at startup and routes domain events
 * to notification handlers.
 *
 * Design decisions:
 *  D3 — Single sync wrapper: (e) => { void route(e).catch(log) }
 *       InProcessEventBus.emit() only guards SYNC throws; async rejects are
 *       unhandled unless we wrap here.  The void + catch pattern ensures:
 *       (a) the emit call-stack never blocks on async work
 *       (b) handler errors are logged, not swallowed silently
 *       (c) the originating mutation is never affected
 */

import type { IEventBus } from "../event-bus/interface.js";
import { routeEvent } from "./handlers.js";
import type { NotificationServiceDeps } from "./types.js";

/**
 * Register the NotificationService on the EventBus.
 *
 * @param bus - The application EventBus instance.
 * @param deps - Optional dependencies (logger).
 * @returns unsubscribe function — call in app onClose hook.
 */
export function registerNotificationService(
  bus: IEventBus,
  deps: NotificationServiceDeps = {},
): () => void {
  const { logger } = deps;

  const unsubscribe = bus.subscribe((event) => {
    void routeEvent(event).catch((err) => {
      logger?.error(
        { err, type: event.type, eventId: event.id },
        "notification handler failed",
      );
    });
  });

  return unsubscribe;
}

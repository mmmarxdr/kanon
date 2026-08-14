/**
 * Forecast listener — KAN-102 PR2 / Phase 8.
 *
 * Subscribes to forecast-relevant domain events on the event bus.
 * Schedules a per-project TRAILING debounce rebuild: N events for the same
 * project within the debounce window collapse to a single rebuild.
 *
 * Design decisions applied:
 *   #5  — Full project rebuild per debounced event (not incremental).
 *   #6  — Trailing debounce, per-project Map<projectId, Timeout>, window =
 *          FORECAST_DEBOUNCE_MS (default 3000 ms).
 *   #10 — worklog.created emitted from work-session/service.ts; subscribed here.
 *   #12 — time-entry.approved with null issueId → SKIP.
 *   Ordinary emit remains fire-and-forget; acknowledgement-aware delivery waits
 *   for the debounced rebuild so durable publishers can retry failures.
 *
 * The AC trigger "issue.state_changed" maps to the real event "issue.transitioned"
 * (the union has no event by that literal name) — wired below.
 *
 * KAN-103 PR3: "interruption.opened" | "interruption.closed" now wired here.
 *   Payload carries interruptedIssueId — the issue whose forecast changes.
 */

import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";
import { rebuildProjectForecast } from "./service.js";
import type { IEventBus } from "../../services/event-bus/interface.js";
import type { DomainEvent, IssueTransitionedPayload } from "../../services/event-bus/types.js";

// ─── Logger interface (minimal — compatible with pino and console) ────────────

export interface ForecastListenerLogger {
  error(obj: unknown, msg?: string): void;
}

// ─── Payload shapes (inlined for type safety without centralised payload registry) ──

interface ScheduleUpdatedPayload {
  issueId: string;
  progress: number;
}

interface EstimateRevisedPayload {
  issueId: string;
  revisionId: string;
  hours: string;
}

interface WorklogCreatedPayload {
  workLogId: string;
  issueId: string;
  workspaceId: string;
}

interface DependencyChangedPayload {
  dependencyId: string;
  sourceIssueId: string;
  targetIssueId: string;
  depType: string;
  lagDays: number;
  action: "created" | "deleted";
}

interface TimeEntryApprovedPayload {
  entryId: string;
  issueId: string | null;
  approvedAt: string;
}

interface InterruptionPayload {
  interruptionId: string;
  incidentIssueId: string;
  interruptedIssueId: string;
  memberId: string;
}

interface ScheduleConfigUpdatedPayload {
  projectId: string;
}

interface PendingRebuild {
  timer?: ReturnType<typeof setTimeout>;
  completion: Promise<void>;
  resolve: () => void;
  reject: (reason: unknown) => void;
}

// ─── projectId resolution ────────────────────────────────────────────────────

/**
 * Resolve the projectId for an issue. Returns null if the issue was deleted
 * between event emit and handler. A single indexed PK lookup — cheap enough to
 * run per event; the per-project debounce collapses bursts to one rebuild.
 */
async function resolveProjectIdFromIssue(issueId: string): Promise<string | null> {
  const issue = await prisma.issue.findUnique({
    where: { id: issueId },
    select: { projectId: true },
  });
  return issue?.projectId ?? null;
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Register the forecast listener on the event bus.
 *
 * Subscribes to all forecast-relevant domain events. For each event, resolves
 * the projectId from the payload and schedules/replaces a per-project trailing
 * debounce timer. The subscriber returns a Promise that settles with the
 * rebuild: ordinary `emit()` remains fire-and-forget through the event bus,
 * while `emitAndWait()` can observe failures and retain durable effects.
 *
 * @param bus    - The application EventBus instance.
 * @param logger - Optional logger (pino-compatible). Defaults to console.
 * @returns unsubscribe function — call in app onClose hook to detach the bus
 *          handler AND clear all pending timers.
 */
export function registerForecastListener(
  bus: IEventBus,
  logger: ForecastListenerLogger = console
): () => void {
  const debounceMs = env.FORECAST_DEBOUNCE_MS;

  // Per-project trailing debounce timers.
  const pendingRebuilds = new Map<string, PendingRebuild>();

  // Active flag: set to false on unsubscribe() so any in-flight async
  // handleEvent calls do not schedule new timers after shutdown.
  // This guards the race where handleEvent awaits a DB lookup and the
  // timer would be scheduled AFTER unsubscribe() has already cleared timers.
  let active = true;

  /**
   * Schedule (or reschedule) a trailing rebuild for the given projectId.
   * If a timer is already pending for this project, it is replaced, resetting
   * the debounce window.
   *
   * Rejects if the listener has already been unsubscribed so a durable caller
   * does not acknowledge work whose rebuild was cancelled during shutdown.
   */
  function scheduleRebuild(projectId: string): Promise<void> {
    // Guard: do not schedule new timers after unsubscribe()
    if (!active) {
      return Promise.reject(new Error("forecast listener is closed"));
    }

    // Reuse one completion promise for every event coalesced into this trailing
    // debounce window. No durable publisher is acknowledged until their shared
    // rebuild succeeds.
    const existing = pendingRebuilds.get(projectId);
    if (existing !== undefined) {
      if (existing.timer !== undefined) clearTimeout(existing.timer);
      existing.timer = createRebuildTimer(projectId, existing);
      return existing.completion;
    }

    let resolve!: () => void;
    let reject!: (reason: unknown) => void;
    const completion = new Promise<void>((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    const pending: PendingRebuild = { completion, resolve, reject };
    pending.timer = createRebuildTimer(projectId, pending);
    pendingRebuilds.set(projectId, pending);
    return completion;
  }

  function createRebuildTimer(projectId: string, pending: PendingRebuild) {
    return setTimeout(() => {
      // A stale timer must never settle the replacement debounce window.
      if (pendingRebuilds.get(projectId) !== pending) return;
      pendingRebuilds.delete(projectId);
      pending.timer = undefined;

      void rebuildProjectForecast(projectId).then(
        () => pending.resolve(),
        (err: unknown) => {
          logger.error({ err, projectId }, "forecast rebuild failed");
          pending.reject(err);
        },
      );
    }, debounceMs);
  }

  /**
   * Central event handler. Extracts the issueId from each supported event type,
   * resolves projectId via a lightweight DB lookup, then calls scheduleRebuild.
   *
   * Unsupported event types are silently ignored (filtered inside the handler
   * rather than at the subscribe level so we hold only one bus subscription).
   *
   * Errors are logged and rethrown to the bus delivery wrapper. Ordinary
   * `emit()` isolates them; `emitAndWait()` exposes them to durable publishers.
   */
  async function handleEvent(event: DomainEvent): Promise<void> {
    let issueId: string | null = null;

    // KAN-147: project-level calendar change carries projectId directly — no
    // issue to resolve. Schedule the rebuild and return early.
    if (event.type === "schedule-config.updated") {
      const p = event.payload as unknown as ScheduleConfigUpdatedPayload;
      if (p.projectId) await scheduleRebuild(p.projectId);
      return;
    }

    // ── Resolve issueId from the event payload ────────────────────────────
    switch (event.type) {
      case "schedule.updated": {
        const p = event.payload as unknown as ScheduleUpdatedPayload;
        issueId = p.issueId ?? null;
        break;
      }

      case "estimate.revised": {
        const p = event.payload as unknown as EstimateRevisedPayload;
        issueId = p.issueId ?? null;
        break;
      }

      case "worklog.created": {
        const p = event.payload as unknown as WorklogCreatedPayload;
        issueId = p.issueId ?? null;
        break;
      }

      case "dependency.changed": {
        const p = event.payload as unknown as DependencyChangedPayload;
        // Use source issue as the project anchor (source always belongs to the project)
        issueId = p.sourceIssueId ?? null;
        break;
      }

      case "time-entry.approved": {
        const p = event.payload as unknown as TimeEntryApprovedPayload;
        // Decision #12: null issueId (issue-less work) → SKIP
        if (p.issueId === null || p.issueId === undefined) return;
        issueId = p.issueId;
        break;
      }

      case "issue.transitioned": {
        // AC trigger "issue.state_changed" → real event name is "issue.transitioned"
        // (the union has no issue.state_changed). A transition changes state +
        // completedAt, which the engine uses to pin forecastEnd. Per-issue events
        // are emitted on both single and batch transitions, so this covers both.
        const p = event.payload as unknown as IssueTransitionedPayload;
        issueId = p.issueId ?? null;
        break;
      }

      case "interruption.opened":
      case "interruption.closed": {
        // KAN-103 PR3: forecast that changes is the interrupted issue's project.
        const p = event.payload as unknown as InterruptionPayload;
        issueId = p.interruptedIssueId ?? null;
        break;
      }

      // ── Explicitly ignored events ────────────────────────────────────────
      case "ppm.forecast.updated":
        // Own output — must NOT self-trigger (infinite loop prevention).
        return;

      default:
        // Not a forecast-relevant event — ignore silently.
        return;
    }

    // ── Resolve projectId from issueId ──────────────────────────────────
    if (!issueId) return;

    const projectId = await resolveProjectIdFromIssue(issueId);
    if (!projectId) {
      // Issue not found (deleted between emit and handler) — skip safely.
      return;
    }

    // scheduleRebuild rejects if shutdown happened during the lookup so durable
    // publication remains pending instead of acknowledging a cancelled rebuild.
    await scheduleRebuild(projectId);
  }

  // ── Subscribe — single handler for all domain events ────────────────────
  const unsubscribeBus = bus.subscribe((event) => {
    // Return the Promise so emitAndWait can treat completion as durable
    // delivery. The in-process bus still isolates this rejection for ordinary
    // fire-and-forget emitters.
    return handleEvent(event).catch((err: unknown) => {
      logger.error(
        { err, eventType: event.type, eventId: event.id },
        "forecast listener event handler failed",
      );
      throw err;
    });
  }, "forecast-listener");

  // ── Return unsubscribe ────────────────────────────────────────────────────
  return function unsubscribe(): void {
    // Mark as inactive — any in-flight async handleEvent won't schedule new timers.
    active = false;

    // Detach from the bus — no new events will arrive.
    unsubscribeBus();

    // Clear ALL pending debounce timers so no rebuild fires after shutdown.
    const closeError = new Error("forecast listener is closed");
    for (const pending of pendingRebuilds.values()) {
      if (pending.timer !== undefined) clearTimeout(pending.timer);
      pending.reject(closeError);
    }
    pendingRebuilds.clear();
  };
}

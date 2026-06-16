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
 *   Listener fire-and-forget: a forecast failure MUST NEVER break the emitter.
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
import type { DomainEvent } from "../../services/event-bus/types.js";

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

interface IssueTransitionedPayload {
  issueKey: string;
  issueId: string;
  projectKey: string;
  from: string;
  to: string;
}

interface InterruptionPayload {
  interruptionId: string;
  incidentIssueId: string;
  interruptedIssueId: string;
  memberId: string;
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
 * debounce timer. When the timer fires, calls rebuildProjectForecast(projectId)
 * fire-and-forget with rejection caught (never propagates to the emitter).
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
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

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
   * No-op if the listener has already been unsubscribed (active === false).
   */
  function scheduleRebuild(projectId: string): void {
    // Guard: do not schedule new timers after unsubscribe()
    if (!active) return;

    // Clear any existing timer for this project (trailing debounce replacement)
    const existing = timers.get(projectId);
    if (existing !== undefined) {
      clearTimeout(existing);
    }

    const handle = setTimeout(() => {
      timers.delete(projectId);
      // Fire-and-forget: rejection caught here — a forecast failure must NEVER
      // propagate to the emitter call stack (design: listener fire-and-forget).
      void rebuildProjectForecast(projectId).catch((err: unknown) => {
        logger.error({ err, projectId }, "forecast rebuild failed");
      });
    }, debounceMs);

    timers.set(projectId, handle);
  }

  /**
   * Central event handler. Extracts the issueId from each supported event type,
   * resolves projectId via a lightweight DB lookup, then calls scheduleRebuild.
   *
   * Unsupported event types are silently ignored (filtered inside the handler
   * rather than at the subscribe level so we hold only one bus subscription).
   *
   * Errors from the async resolution path are caught and logged — they must not
   * propagate to the bus emitter.
   */
  async function handleEvent(event: DomainEvent): Promise<void> {
    let issueId: string | null = null;

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

    // scheduleRebuild checks active flag internally; safe even if unsubscribed
    // during the await above.
    scheduleRebuild(projectId);
  }

  // ── Subscribe — single handler for all domain events ────────────────────
  const unsubscribeBus = bus.subscribe((event) => {
    // Wrap the async handler with fire-and-forget + catch: the bus expects a
    // sync callback and must never see a rejection bubble up.
    void handleEvent(event).catch((err: unknown) => {
      logger.error(
        { err, eventType: event.type, eventId: event.id },
        "forecast listener event handler failed"
      );
    });
  }, "forecast-listener");

  // ── Return unsubscribe ────────────────────────────────────────────────────
  return function unsubscribe(): void {
    // Mark as inactive — any in-flight async handleEvent won't schedule new timers.
    active = false;

    // Detach from the bus — no new events will arrive.
    unsubscribeBus();

    // Clear ALL pending debounce timers so no rebuild fires after shutdown.
    for (const handle of timers.values()) {
      clearTimeout(handle);
    }
    timers.clear();
  };
}

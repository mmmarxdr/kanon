import { z } from "zod";
import {
  workCaptureCommandSchema,
  workCaptureEffectResponseSchema,
  workCaptureIntentSnapshotSchema,
  workCaptureHydrationPageSchema,
  workLogItemSchema,
  workLogListResponseSchema,
} from "@kanon/shared";

/**
 * Issue key param for work session routes.
 */
export const IssueKeyParam = z.object({
  key: z.string(),
});

/**
 * Start work session request body.
 */
export const StartWorkSessionBody = z.object({
  source: z.string().max(50).default("mcp"),
});
export type StartWorkSessionBody = z.infer<typeof StartWorkSessionBody>;

/** Full public command for one durable WorkCaptureIntent effect. */
export const WorkCaptureCommandBody = workCaptureCommandSchema;
export type WorkCaptureCommandBody = z.infer<typeof WorkCaptureCommandBody>;

/** Heartbeat remains body-optional; a full command opts into durable activity. */
export const WorkSessionHeartbeatBody = z.union([z.object({}).strict(), workCaptureCommandSchema]);
export type WorkSessionHeartbeatBody = z.infer<typeof WorkSessionHeartbeatBody>;

export const WorkCaptureIntentSnapshot = workCaptureIntentSnapshotSchema;
export type WorkCaptureIntentSnapshot = z.infer<typeof WorkCaptureIntentSnapshot>;

export const WorkCaptureEffectResponse = workCaptureEffectResponseSchema;
export type WorkCaptureEffectResponse = z.infer<typeof WorkCaptureEffectResponse>;

export const WorkCaptureHydrationQuery = z
  .object({
    workspaceId: z.string().uuid(),
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(100),
  })
  .strict();
export type WorkCaptureHydrationQuery = z.infer<typeof WorkCaptureHydrationQuery>;

export const WorkCaptureHydrationPage = workCaptureHydrationPageSchema;
export type WorkCaptureHydrationPage = z.infer<typeof WorkCaptureHydrationPage>;

/**
 * KAN-103 — manually record an Interruption (no active session required).
 * :key is the incident issue; interruptedIssueKey is the displaced issue.
 */
export const RecordInterruptionBody = z.object({
  interruptedIssueKey: z.string(),
  via: z.string().max(50).optional(),
});
export type RecordInterruptionBody = z.infer<typeof RecordInterruptionBody>;

/**
 * Active worker response shape.
 */
export const ActiveWorkerResponse = z.object({
  userId: z.string().uuid(),
  memberId: z.string().uuid(),
  username: z.string(),
  isAgent: z.boolean(),
  startedAt: z.string().datetime(),
  source: z.string(),
});
export type ActiveWorkerResponse = z.infer<typeof ActiveWorkerResponse>;

// ── S2 / KAN-26 — WorkLog list schemas ────────────────────────────────────
// @kanon/shared is the single source of truth; re-export for use within this module.

/** @see workLogItemSchema in @kanon/shared */
export const WorkLogItem = workLogItemSchema;
export type WorkLogItem = z.infer<typeof WorkLogItem>;

/** @see workLogListResponseSchema in @kanon/shared */
export const WorkLogListResponse = workLogListResponseSchema;
export type WorkLogListResponse = z.infer<typeof WorkLogListResponse>;

/**
 * Query params for GET /api/me/worklogs
 */
export const MeWorkLogsQuery = z.object({
  // KAN-82: required — without it the endpoint aggregated the caller's worklogs
  // across ALL their workspaces, leaking other-workspace activity (issue keys,
  // durations, sources) into a single-workspace client context. Results are
  // still scoped to the caller's own membership in this workspace.
  workspaceId: z.string().uuid(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
});
export type MeWorkLogsQuery = z.infer<typeof MeWorkLogsQuery>;

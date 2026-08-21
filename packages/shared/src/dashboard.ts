/**
 * Dashboard bridge schemas — inbox-redesign-cycle-c
 *
 * Shared Zod schemas for the dashboard endpoint response shape.
 * Consumed by both @kanon/api (response validation) and @kanon/web
 * (type inference via z.infer<>).
 *
 * Design §2.2 — activeCycleKPIsSchema
 * Design §2.3 — mentionDashboardItemSchema
 * Design §2.4 — dashboardResponseSchema
 */

import { z } from "zod";
import { workCaptureFailureNotificationPayloadSchema } from "./work-capture.js";

// ─── ActiveCycleKPIs ────────────────────────────────────────────────────────

/**
 * KPI snapshot for the active cycle shown in the Inbox right-rail card.
 * `avgLeadDays` is null when no issues have a state_changed→done event
 * (REQ-INBOX-CYCLE-002 MUST NOT show "0d" in that case).
 */
export const activeCycleKPIsSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  projectName: z.string(),
  startDate: z.string(), // ISO date "YYYY-MM-DD"
  endDate: z.string(), // ISO date "YYYY-MM-DD"
  completed: z.number().int().min(0),
  scope: z.number().int().min(0),
  donePct: z.number().int().min(0).max(100), // round(completed/scope*100), 0 if scope=0
  velocity: z.number().int().min(0),
  avgLeadDays: z.number().nullable(), // null = no eligible issues
  burnup: z.array(z.number()), // cumulative completions per day
});

export type ActiveCycleKPIs = z.infer<typeof activeCycleKPIsSchema>;

// ─── MentionDashboardItem ───────────────────────────────────────────────────

/**
 * A mention entry shown in the Inbox Mentions section.
 * `commentId` is null when the mention comes from an Issue.description
 * (not from a comment). Frontend uses this to determine navigation target.
 */
export const mentionDashboardItemSchema = z.object({
  id: z.string().uuid(),
  issueKey: z.string(),
  issueTitle: z.string(),
  commentId: z.string().uuid().nullable(), // null for description mentions
  mentionedByUsername: z.string(),
  context: z.string(), // verbatim snippet containing the @mention
  createdAt: z.string(), // ISO datetime
});

export type MentionDashboardItem = z.infer<typeof mentionDashboardItemSchema>;

// ─── DashboardResponse ──────────────────────────────────────────────────────

/**
 * Full dashboard endpoint response shape.
 * `assigned`, `proposals`, and `agents` remain z.unknown() arrays because
 * those types are not yet shared through the bridge (they use API-internal
 * types). Frontend continues to use local interfaces for those fields.
 *
 * NEW in inbox-redesign-cycle-c:
 * - activeCycle: ActiveCycleKPIs | null (REQ-API-DASHBOARD-002)
 * - multipleActiveProjects: boolean    (REQ-API-DASHBOARD-005)
 * - mentions: MentionDashboardItem[]   (REQ-MENTION-007, typed, no longer unknown[])
 */
// ─── NotificationDashboardItem ────────────────────────────────────────────────

/**
 * A notification entry shown in the Inbox Notifications section.
 * Added in S3 / KAN-27 (notifications core).
 */
export const notificationDashboardItemSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.enum([
      "mention",
      "assignment",
      "subscribed_activity",
      "cycle_closed",
      "work_capture_failure",
    ]),
    issueId: z.string().uuid().nullable(),
    actorId: z.string().uuid().nullable(),
    mentionId: z.string().uuid().nullable(),
    payload: z.record(z.unknown()).nullable(),
    read: z.boolean(),
    via: z.string().nullable(),
    createdAt: z.string(), // ISO datetime
  })
  .superRefine((value, context) => {
    if (
      value.kind === "work_capture_failure" &&
      !workCaptureFailureNotificationPayloadSchema.safeParse(value.payload).success
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payload"],
        message: "Invalid work-capture failure payload",
      });
    }
  });

export type NotificationDashboardItem = z.infer<typeof notificationDashboardItemSchema>;

// ─── DashboardResponse ────────────────────────────────────────────────────────

export const dashboardResponseSchema = z.object({
  counts: z.object({
    openIssues: z.number().int(),
    inProgress: z.number().int(),
    awaitingReview: z.number().int(),
    activeAgents: z.number().int(),
  }),
  assigned: z.array(z.unknown()),
  mentions: z.array(mentionDashboardItemSchema),
  proposals: z.array(z.unknown()),
  agents: z.array(z.unknown()),
  activeCycle: activeCycleKPIsSchema.nullable(),
  multipleActiveProjects: z.boolean(),
  // S3 / KAN-27: Additive fields — parse-level backward-compatible.
  // Absent in older API response shapes → default to empty array / zero so
  // existing clients and the bridge sync engine do not fail to parse.
  // The comment claiming backward-compat was misleading: these fields ARE required
  // at the type level but default to safe values at parse time (Fix 6).
  notifications: z.array(notificationDashboardItemSchema).default([]),
  unreadCount: z.number().int().min(0).default(0),
});

export type DashboardData = z.infer<typeof dashboardResponseSchema>;

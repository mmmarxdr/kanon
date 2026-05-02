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
  startDate: z.string(),                            // ISO date "YYYY-MM-DD"
  endDate: z.string(),                              // ISO date "YYYY-MM-DD"
  completed: z.number().int().min(0),
  scope: z.number().int().min(0),
  donePct: z.number().int().min(0).max(100),        // round(completed/scope*100), 0 if scope=0
  velocity: z.number().int().min(0),
  avgLeadDays: z.number().nullable(),               // null = no eligible issues
  burnup: z.array(z.number()),                      // cumulative completions per day
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
  commentId: z.string().uuid().nullable(),          // null for description mentions
  mentionedByUsername: z.string(),
  context: z.string(),                              // verbatim snippet containing the @mention
  createdAt: z.string(),                            // ISO datetime
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
});

export type DashboardData = z.infer<typeof dashboardResponseSchema>;

import { z } from "zod";

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

/**
 * A single WorkLog item in list responses.
 * Design: { id, startedAt, endedAt, durationS, reason, via, issueId, member:{id,username,isAgent} }
 */
export const WorkLogItem = z.object({
  id: z.string().uuid(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  durationS: z.number().int().nonnegative(),
  reason: z.enum(["stopped", "expired"]),
  via: z.string().nullable(),
  issueId: z.string().uuid(),
  member: z.object({
    id: z.string().uuid(),
    username: z.string(),
    isAgent: z.boolean(),
  }),
});
export type WorkLogItem = z.infer<typeof WorkLogItem>;

/**
 * Response for GET /api/issues/:key/worklogs
 */
export const WorkLogListResponse = z.object({
  worklogs: z.array(WorkLogItem),
  totalDurationS: z.number().int().nonnegative(),
});
export type WorkLogListResponse = z.infer<typeof WorkLogListResponse>;

/**
 * Query params for GET /api/me/worklogs
 */
export const MeWorkLogsQuery = z.object({
  workspaceId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
});
export type MeWorkLogsQuery = z.infer<typeof MeWorkLogsQuery>;

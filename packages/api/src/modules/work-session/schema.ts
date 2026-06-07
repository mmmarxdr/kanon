import { z } from "zod";
import {
  workLogItemSchema,
  workLogListResponseSchema,
} from "@kanon/bridge";

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
// Bridge is the single source of truth; re-export for use within this module.

/** @see workLogItemSchema in @kanon/bridge */
export const WorkLogItem = workLogItemSchema;
export type WorkLogItem = z.infer<typeof WorkLogItem>;

/** @see workLogListResponseSchema in @kanon/bridge */
export const WorkLogListResponse = workLogListResponseSchema;
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

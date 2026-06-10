// ─── WorkLog bridge schemas (S2 / KAN-26) ─────────────────────────────────────

import { z } from "zod";

/**
 * A single WorkLog item returned by GET /api/issues/:key/worklogs
 * and GET /api/me/worklogs.
 */
export const workLogItemSchema = z.object({
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
export type WorkLogItem = z.infer<typeof workLogItemSchema>;

/**
 * Response for GET /api/issues/:key/worklogs and GET /api/me/worklogs.
 */
export const workLogListResponseSchema = z.object({
  worklogs: z.array(workLogItemSchema),
  totalDurationS: z.number().int().nonnegative(),
});
export type WorkLogListResponse = z.infer<typeof workLogListResponseSchema>;

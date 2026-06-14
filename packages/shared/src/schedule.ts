/**
 * Shared response schemas for the PPM schedule module (KAN-99).
 *
 * Decimal convention (LOCKED):
 *   All Decimal fields (estimateHours) cross the API boundary as strings.
 *   Prisma returns Prisma.Decimal objects; Fastify's JSON.stringify calls
 *   .toString() automatically, producing e.g. "3.50".
 *   Zod schemas at this boundary MUST use z.string() (never z.number() or
 *   z.coerce.number()) to preserve precision and avoid floating-point loss.
 *   At display edges (React components), convert: Number(estimateHours).
 */

import { z } from "zod";

/**
 * IssueSchedule response shape.
 * estimateHours is nullable — absent until reviseEstimate is called.
 */
export const issueScheduleSchema = z.object({
  issueId: z.string().uuid(),
  startDate: z.string().datetime().nullable(),
  dueDate: z.string().datetime().nullable(),
  progress: z.number().int().min(0).max(100),
  // Decimal convention: string at boundary
  estimateHours: z.string().nullable(),
  baselineStart: z.string().datetime().nullable(),
  baselineEnd: z.string().datetime().nullable(),
  baselineSetAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type IssueSchedule = z.infer<typeof issueScheduleSchema>;

/**
 * EstimateRevision response shape.
 * hours is a string (Decimal convention — see module doc).
 */
export const estimateRevisionSchema = z.object({
  id: z.string().uuid(),
  issueId: z.string().uuid(),
  // Decimal convention: string at boundary
  hours: z.string(),
  reason: z.string().nullable(),
  authorId: z.string().uuid(),
  via: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type EstimateRevision = z.infer<typeof estimateRevisionSchema>;

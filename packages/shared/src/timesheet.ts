/**
 * Shared response schemas for the PPM timesheet module (KAN-100).
 *
 * Decimal convention (LOCKED):
 *   All Decimal fields (hours, costRateSnapshot, billRateSnapshot) cross the
 *   API boundary as strings. Prisma returns Prisma.Decimal objects; Fastify's
 *   JSON.stringify calls .toString() automatically.
 *   Zod schemas at this boundary MUST use z.string() (never z.number() or
 *   z.coerce.number()) to preserve precision and avoid floating-point loss.
 *   At display edges (React components), convert: Number(hours).
 */

import { z } from "zod";

/** Valid TimeEntry lifecycle statuses. */
export const timeEntryStatusSchema = z.enum(["draft", "submitted", "approved", "rejected"]);
export type TimeEntryStatus = z.infer<typeof timeEntryStatusSchema>;

/**
 * TimeEntry response shape.
 *
 * hours / costRateSnapshot / billRateSnapshot are strings (Decimal convention).
 * Rate snapshots are nullable — null in W1 until MemberRate model lands (KAN-rate / PPM P1).
 */
export const timeEntrySchema = z.object({
  id: z.string().uuid(),
  memberId: z.string().uuid(),
  issueId: z.string().uuid().nullable(),
  // Decimal convention: string at boundary
  hours: z.string(),
  workedOn: z.string().datetime(),
  status: timeEntryStatusSchema,
  sourceWorkLogId: z.string().uuid().nullable(),
  adjustsId: z.string().uuid().nullable(),
  // Rate snapshots — null in W1; populated when MemberRate model lands
  costRateSnapshot: z.string().nullable(),
  billRateSnapshot: z.string().nullable(),
  via: z.string().nullable(),
  approvedById: z.string().uuid().nullable(),
  approvedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TimeEntry = z.infer<typeof timeEntrySchema>;

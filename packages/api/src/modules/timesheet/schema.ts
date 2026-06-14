import { z } from "zod";

/**
 * Decimal string regex — mirrors DECIMAL(8,2) max 999999.99.
 * Accepts only non-negative decimal strings with up to 2 decimal places.
 * Note: negative hours for adjustments are NOT accepted through this regex;
 * the adjustment body uses a signed variant (AdjustmentHoursSchema).
 */
const HoursRegex = /^\d{1,6}(\.\d{1,2})?$/;
const HoursRegexMessage =
  "hours must be a non-negative decimal with up to 2 decimal places and max 999999.99";

/**
 * Signed decimal string regex for adjustment hours (negative allowed).
 * DECIMAL(8,2): max ±999999.99.
 */
const SignedHoursRegex = /^-?\d{1,6}(\.\d{1,2})?$/;
const SignedHoursRegexMessage =
  "hours must be a decimal with up to 2 decimal places and magnitude max 999999.99";

// ── URL params ────────────────────────────────────────────────────────────────

/** URL param for time-entry ID routes. */
export const TimeEntryIdParam = z.object({
  id: z.string().uuid(),
});
export type TimeEntryIdParam = z.infer<typeof TimeEntryIdParam>;

/** URL param for worklog ID routes. */
export const WorkLogIdParam = z.object({
  id: z.string().uuid(),
});
export type WorkLogIdParam = z.infer<typeof WorkLogIdParam>;

// ── Request bodies ────────────────────────────────────────────────────────────

/**
 * Body for POST /api/worklogs/:id/promote
 * All fields optional — the service prefills from the WorkLog row.
 * hours overrides the durationS→hours conversion when supplied.
 */
export const PromoteWorkLogBody = z.object({
  hours: z.string().regex(HoursRegex, HoursRegexMessage).optional(),
  issueId: z.string().uuid().optional(),
  workedOn: z.string().datetime().optional(),
});
export type PromoteWorkLogBody = z.infer<typeof PromoteWorkLogBody>;

/**
 * Body for PATCH /api/time-entries/:id
 * Partial update: owner may change hours, issueId, workedOn while status is draft/submitted.
 */
export const UpdateEntryBody = z
  .object({
    hours: z.string().regex(HoursRegex, HoursRegexMessage),
    issueId: z.string().uuid().nullable(),
    workedOn: z.string().datetime(),
  })
  .partial();
export type UpdateEntryBody = z.infer<typeof UpdateEntryBody>;

/**
 * Body for POST /api/time-entries/:id/reject
 */
export const RejectEntryBody = z.object({
  reason: z.string().max(500).optional(),
});
export type RejectEntryBody = z.infer<typeof RejectEntryBody>;

/**
 * Body for POST /api/time-entries/:id/adjust
 * hours may be negative (corrections reducing logged time).
 * Signed regex: -999999.99 to 999999.99.
 */
export const CreateAdjustmentBody = z.object({
  hours: z.string().regex(SignedHoursRegex, SignedHoursRegexMessage),
  workedOn: z.string().datetime(),
  issueId: z.string().uuid().nullable().optional(),
});
export type CreateAdjustmentBody = z.infer<typeof CreateAdjustmentBody>;

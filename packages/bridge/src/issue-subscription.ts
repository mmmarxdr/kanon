// ─── IssueSubscription bridge schemas (S4 / KAN-28) ────────────────────────────

import { z } from "zod";

/**
 * Response schema for subscription status endpoints:
 *  PUT    /api/issues/:key/subscription
 *  DELETE /api/issues/:key/subscription
 *  GET    /api/issues/:key/subscription
 *
 * Single source of truth: consumed by @kanon/api (response validation)
 * and available for @kanon/web (type inference via z.infer<>).
 */
export const subscriptionStatusSchema = z.object({
  subscribed: z.boolean(),
});

export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;

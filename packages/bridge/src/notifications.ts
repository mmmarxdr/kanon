/**
 * Bridge schemas for notification preferences (S5 / KAN-29).
 * Single source of truth — API and web re-export from here.
 */

import { z } from "zod";

/**
 * Notification preference item schema.
 * Models the three email preference booleans.
 * All default to true (absent row = default ON).
 */
export const notificationPreferenceItemSchema = z.object({
  emailMention: z.boolean(),
  emailAssignment: z.boolean(),
  emailCycleClosed: z.boolean(),
});

export type NotificationPreferenceItem = z.infer<typeof notificationPreferenceItemSchema>;

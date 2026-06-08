/**
 * NotificationService types — S3 / KAN-27
 */

import type { NotificationKind } from "@prisma/client";
import type { DomainEvent } from "../event-bus/types.js";

/**
 * Input to create a notification row.
 */
export interface CreateNotificationInput {
  kind: NotificationKind;
  workspaceId: string;
  recipientId: string;
  actorId?: string | null;
  issueId?: string | null;
  mentionId?: string | null;
  commentId?: string | null;
  payload?: Record<string, unknown>;
  via?: string | null;
}

/**
 * A handler processes one domain event and writes notification rows.
 * Returns true if a notification was written, false if skipped.
 */
export type NotificationHandler = (
  event: DomainEvent,
) => Promise<void>;

/**
 * Dependencies injected into registerNotificationService.
 */
export interface NotificationServiceDeps {
  logger?: {
    error: (obj: unknown, msg?: string) => void;
    info?: (obj: unknown, msg?: string) => void;
  };
  /** Optional email provider — when omitted, no emails are dispatched (S5). */
  emailProvider?: import("../email/types.js").EmailProvider;
}

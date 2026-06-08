/**
 * Activity log serializer.
 *
 * Transforms raw DB activity log rows into the shape expected by the
 * frontend ActivityLog feed.
 *
 * KAN-41: The canonical convention for state_changed logs is
 * `details: { from, to }`. The serializer reads that via `readStateChange`
 * and falls back to legacy `{ oldValue, newValue }` keys for any rows
 * persisted before this convention was established.
 */

import { readStateChange } from "../../shared/activity-log.js";

interface RawActivityLog {
  id: string;
  action: string;
  details: unknown;
  createdAt: Date;
  member?: { id: string; username: string } | null;
}

export interface SerializedActivityLog {
  id: string;
  action: string;
  field: string | undefined;
  oldValue: string | undefined;
  newValue: string | undefined;
  actor: { id: string; username: string };
  createdAt: Date;
}

/**
 * Serialize a single raw activity log row into the frontend feed shape.
 *
 * Details JSON convention:
 *  - `details.from` / `details.to`  — canonical (state_changed writers)
 *  - `details.oldValue` / `details.newValue` — legacy fallback
 */
export function serializeActivityLog(log: RawActivityLog): SerializedActivityLog {
  const { from, to } = readStateChange(log.details);

  const details =
    log.details && typeof log.details === "object" && !Array.isArray(log.details)
      ? (log.details as Record<string, unknown>)
      : {};

  return {
    id: log.id,
    action: log.action,
    field: typeof details["field"] === "string" ? details["field"] : undefined,
    oldValue: typeof from === "string" ? from : undefined,
    newValue: typeof to === "string" ? to : undefined,
    actor: log.member
      ? { id: log.member.id, username: log.member.username }
      : { id: "unknown", username: "unknown" },
    createdAt: log.createdAt,
  };
}

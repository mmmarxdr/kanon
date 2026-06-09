/**
 * KAN-32 — Unified issue timeline hook + pure merge function.
 *
 * mergeTimeline(comments, activity) is a pure function (no React) that:
 *   1. Maps comments → TimelineItem (human-comment | agent-comment)
 *   2. Filters activity to remove action="commented" shadow audit rows
 *   3. Maps remaining activity → TimelineItem by action kind
 *   4. Concat + sorts by createdAt ASC; tiebreak: id.localeCompare(id) ASC
 *
 * useUnifiedTimeline(issueKey) composes existing useCommentsQuery +
 * useActivityQuery (no new fetch), memoises the merge, and returns
 * { items, isLoading, isError }.
 *
 * AI sources (→ agent-comment): mcp | engram_sync | system | adr
 * Everything else (→ human-comment).
 */

import { useMemo } from "react";
import type { Comment, ActivityLog } from "@/types/issue";
import { useCommentsQuery, useActivityQuery } from "./use-issue-detail-queries";
import type { TimelineItem, Actor } from "./timeline-types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENT_SOURCES = new Set(["mcp", "engram_sync", "system", "adr"]);

// ---------------------------------------------------------------------------
// Pure merge function (exported for unit testing without React)
// ---------------------------------------------------------------------------

export function mergeTimeline(
  comments: Comment[],
  activity: ActivityLog[],
): TimelineItem[] {
  const commentItems: TimelineItem[] = comments.map((c) => {
    const actor: Actor = c.author ?? null;
    if (AGENT_SOURCES.has(c.source)) {
      return {
        kind: "agent-comment",
        id: c.id,
        via: c.via,
        createdAt: c.createdAt,
        body: c.body,
        source: c.source,
        author: actor,
      } satisfies TimelineItem;
    }
    return {
      kind: "human-comment",
      id: c.id,
      via: c.via,
      createdAt: c.createdAt,
      body: c.body,
      author: actor,
    } satisfies TimelineItem;
  });

  const activityItems: TimelineItem[] = activity
    .filter((log) => log.action !== "commented")
    .map((log) => mapActivityToItem(log));

  return [...commentItems, ...activityItems].sort((a, b) => {
    const timeDiff = a.createdAt.localeCompare(b.createdAt);
    if (timeDiff !== 0) return timeDiff;
    return a.id.localeCompare(b.id);
  });
}

function mapActivityToItem(log: ActivityLog): TimelineItem {
  const actor: Actor = log.actor ?? null;
  const base = { id: log.id, via: log.via, createdAt: log.createdAt };

  switch (log.action) {
    case "state_changed":
      return {
        ...base,
        kind: "state-change",
        from: log.oldValue ?? null,
        to: log.newValue ?? null,
        actor,
      };
    case "created":
      return { ...base, kind: "created", actor };
    case "assigned":
      return {
        ...base,
        kind: "assigned",
        field: log.field ?? null,
        newValue: log.newValue ?? null,
        actor,
      };
    case "edited":
      return {
        ...base,
        kind: "field-change",
        field: log.field ?? null,
        from: log.oldValue ?? null,
        to: log.newValue ?? null,
        actor,
      };
    case "delete":
      return { ...base, kind: "deleted", actor };
    case "document_added":
      return { ...base, kind: "document-added", field: log.field ?? null, actor };
    default:
      // Safe fallback for any future action values
      return {
        ...base,
        kind: "field-change",
        field: log.field ?? null,
        from: log.oldValue ?? null,
        to: log.newValue ?? null,
        actor,
      };
  }
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

export interface UnifiedTimelineResult {
  items: TimelineItem[];
  isLoading: boolean;
  isError: boolean;
}

export function useUnifiedTimeline(
  issueKey: string | undefined,
): UnifiedTimelineResult {
  const {
    data: comments,
    isLoading: commentsLoading,
    isError: commentsError,
  } = useCommentsQuery(issueKey);

  const {
    data: activity,
    isLoading: activityLoading,
    isError: activityError,
  } = useActivityQuery(issueKey);

  const items = useMemo(
    () => mergeTimeline(comments ?? [], activity ?? []),
    [comments, activity],
  );

  return {
    items,
    isLoading: commentsLoading || activityLoading,
    isError: commentsError || activityError,
  };
}

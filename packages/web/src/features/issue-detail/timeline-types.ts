/**
 * KAN-32 — Unified Issue Timeline types.
 *
 * TimelineItem is the discriminated union used by useUnifiedTimeline and
 * UnifiedTimeline. Every member carries id, via, and createdAt from
 * TimelineBase. Narrow on `kind` to get full type safety with no casts.
 *
 * Design corrections applied here (design.md § "Corrections to the spec"):
 *   - No `sync` kind — provenance is the `via` badge on ANY item.
 *   - `commented` activity rows are filtered out before merge (shadow audit).
 *   - Kinds aligned to real ActivityLog action values.
 */

import type { CommentSource } from "@/types/issue";

export type Actor = { id?: string; username: string; provider?: string } | null;

type TimelineBase = { id: string; via: string | null; createdAt: string };

export type TimelineItem =
  | (TimelineBase & { kind: "human-comment"; body: string; author: Actor })
  | (TimelineBase & {
      kind: "agent-comment";
      body: string;
      source: CommentSource;
      author: Actor;
    })
  | (TimelineBase & {
      kind: "state-change";
      from: string | null;
      to: string | null;
      actor: Actor;
    })
  | (TimelineBase & { kind: "created"; actor: Actor })
  | (TimelineBase & {
      kind: "assigned";
      field: string | null;
      newValue: string | null;
      actor: Actor;
    })
  | (TimelineBase & {
      kind: "field-change";
      field: string | null;
      from: string | null;
      to: string | null;
      actor: Actor;
    })
  | (TimelineBase & { kind: "deleted"; actor: Actor })
  | (TimelineBase & { kind: "document-added"; field: string | null; actor: Actor });

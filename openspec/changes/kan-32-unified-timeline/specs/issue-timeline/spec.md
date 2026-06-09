# Spec: KAN-32 — Unified Issue Timeline

## Status: draft
## Change: kan-32-unified-timeline
## Author: SDD spec phase
## Date: 2026-06-09

---

## 1. Purpose

Replace the split Comments / Agent / Activity tab layout in the issue detail main pane with a single chronological timeline that interleaves all comment and activity entries. Items originating from AI tools carry a cobalt `via` badge.

---

## 2. Formal Requirements

### 2.1 Timeline Composition

**REQ-TL-01**: The issue detail main pane MUST display exactly one timeline feed that merges all `Comment` rows and all `ActivityLog` rows for the issue.

**REQ-TL-02**: The feed MUST be ordered by `createdAt` ASC (oldest entry at the top, newest at the bottom — chat style). The current DESC ordering of `ActivityList` MUST NOT be assumed or reused.

**REQ-TL-03**: When two items share the same `createdAt` timestamp, ordering MUST be deterministically stable. The tiebreak rule is: sort by `id` ASC (lexicographic for string IDs, numeric for integer IDs). This rule applies regardless of the item kind.

**REQ-TL-04**: The feed MUST include ALL `ActivityLog` kinds: comments (both human and agent), state changes, issue creation, assignment, label changes, priority changes, estimate changes, and sync events.

**REQ-TL-05**: The merged feed MUST be computed client-side by a `useUnifiedTimeline(issueKey)` hook that reads from the existing query caches for `GET /api/issues/:key/comments` and `GET /api/issues/:key/activity`. No new API endpoint is required.

**REQ-TL-06**: The `Comments` tab, `Activity` tab, and `AgentThread` right-pane component MUST NOT be the primary rendering surface for the conversation thread after this change. The `UnifiedTimeline` component in the main pane is the authoritative view.

---

### 2.2 TimelineItem Discriminated Union

**REQ-TI-01**: The client MUST define a `TimelineItem` discriminated union typed by a `kind` field. Every member MUST carry `id`, `via: string | null`, and `createdAt: string`.

**REQ-TI-02**: The following `kind` values MUST exist:

| kind | Source | Additional required fields |
|---|---|---|
| `human-comment` | Comment row where `source` ∉ AI sources | `body: string`, `author: User` |
| `agent-comment` | Comment row where `source` ∈ AI sources | `body: string`, `source: string`, `author: User \| null` |
| `state-change` | ActivityLog with kind `state-change` | `from: string \| null`, `to: string \| null`, `actor: User \| null` |
| `created` | ActivityLog with kind `created` | `actor: User \| null` |
| `assigned` | ActivityLog with kind `assigned` | `field: string \| null`, `newValue: string \| null`, `actor: User \| null` |
| `sync` | ActivityLog with kind `sync` | `action: string \| null`, `actor: User \| null` |
| `generic-field-change` | Any other ActivityLog kind | `field: string \| null`, `from: string \| null`, `to: string \| null`, `actor: User \| null` |

**REQ-TI-03**: The `kind` field MUST be the discriminant — TypeScript narrowing on `kind` MUST fully determine the shape of the item without casting.

---

### 2.3 `via` Field — API Layer

**REQ-API-01**: `SerializedActivityLog` (API interface) MUST include `via: string | null`.

**REQ-API-02**: The `serializeActivityLog()` function MUST map `log.via ?? null` to the `via` field in its return value.

**REQ-API-03**: The comment endpoint (`GET /api/issues/:key/comments`) already returns `via` on each row. No change to that endpoint is required.

**REQ-API-04**: The `RawActivityLog` type and the Prisma `findMany` query for activity MUST NOT exclude the `via` scalar column via an explicit `select`. The `via` value MUST be readable by the serializer.

---

### 2.4 `via` Field — Web Types

**REQ-WT-01**: The web-layer `Comment` type MUST include `via: string | null`.

**REQ-WT-02**: The web-layer `ActivityLog` type MUST include `via: string | null`.

---

### 2.5 `via` Badge Component

**REQ-VB-01**: A `ViaBadge` (or equivalent) component MUST render a cobalt badge when `via` is a recognized AI-tool value. The badge MUST display a human-readable label and an icon.

**REQ-VB-02**: The `via` → display label mapping MUST be:

| `via` value | Display label |
|---|---|
| `claude-code` | Claude Code |
| `cursor` | Cursor |
| `antigravity` | Antigravity |
| `cli` | CLI |

**REQ-VB-03**: The badge MUST use cobalt color `oklch(0.52 0.11 245)` for its visual treatment.

**REQ-VB-04**: When `via` is `"web"`, the component MUST render nothing (no badge, no whitespace placeholder).

**REQ-VB-05**: When `via` is `null`, the component MUST render nothing.

**REQ-VB-06**: When `via` is any value not listed in REQ-VB-02 and not `"web"` or `null`, the component MUST render nothing (unknown future values are silently ignored).

---

### 2.6 Composer

**REQ-CM-01**: The comment composer MUST be pinned at the bottom of the issue detail main pane, outside the timeline feed scroll area.

**REQ-CM-02**: There MUST be exactly one composer instance on the issue detail page. The embedded compose form inside `CommentList` MUST be removed.

**REQ-CM-03**: Posting a comment via the bottom-bar composer MUST invalidate both the comments query cache and the activity query cache so the new comment appears in the unified feed without a manual page refresh.

---

### 2.7 No Nested Replies

**REQ-NR-01**: The timeline MUST NOT support threaded or nested replies. Every item is a top-level entry in the flat chronological feed.

---

### 2.8 Dead Code Removal

**REQ-DC-01**: The file `tabs-section.tsx` (verified to have no importers) MUST be deleted as part of this change.

---

## 3. Non-Goals (Explicit Scope Exclusions)

The following are OUT OF SCOPE. The `sdd-verify` phase MUST NOT flag their absence as failures.

- **Right pane / AgentThread restructure**: `AgentThread` is left in place. Agent comments will appear in both the unified feed and the right pane (transitional duplication, accepted until the sidebar rework lands in a separate change).
- **Issue-level SSE / real-time**: Timeline refresh remains mutation-invalidation (pull-based) only. No WebSocket or SSE subscription is added.
- **Server-side `/timeline` endpoint**: No new combined API route. Client-side merge (Approach A) is the chosen approach.
- **Pagination**: Neither existing endpoint paginates; no pagination is added here.
- **`via` backfill on historical rows**: `null` means pre-provenance (per KAN-30). Historical nulls are not modified.
- **Comment edit / delete behavior**: Existing behavior is preserved unchanged.

---

## 4. Acceptance Scenarios

### Scenario 1 — Happy path: interleaved feed renders in ASC order

```
Given an issue has 2 comments and 3 activity entries with distinct createdAt timestamps
When the issue detail page loads
Then the main pane shows exactly 5 items in a single feed
And the items are ordered oldest-first (lowest createdAt at top)
And no separate "Comments" or "Activity" tabs are the primary view
```

### Scenario 2 — `via` badge shown for AI-tool items

```
Given a TimelineItem has via = "claude-code"
When that item is rendered in the UnifiedTimeline
Then a cobalt badge with label "Claude Code" and an icon is displayed on the item
```

### Scenario 3 — `via` badge shown for each recognized AI tool

```
Given items with via = "cursor", "antigravity", "cli" respectively
When each item is rendered
Then badges display "Cursor", "Antigravity", "CLI" in cobalt color
```

### Scenario 4 — No badge for `via = "web"`

```
Given a TimelineItem has via = "web"
When that item is rendered
Then no via badge is rendered on that item
```

### Scenario 5 — No badge for `via = null`

```
Given a TimelineItem has via = null
When that item is rendered
Then no via badge is rendered on that item
```

### Scenario 6 — Composer posts into the same feed

```
Given the user types a comment in the bottom-bar composer and submits
When the mutation succeeds
Then both the comments and activity query caches are invalidated
And the new comment appears in the unified feed without a page refresh
And the feed remains ordered by createdAt ASC
```

### Scenario 7 — Empty timeline

```
Given an issue has no comments and no activity entries
When the issue detail page loads
Then the main pane renders the timeline with an empty-state indicator
And the bottom-bar composer is still visible and functional
```

### Scenario 8 — Loading state

```
Given the comments or activity query is in a loading state
When the UnifiedTimeline renders
Then a loading indicator is shown in the main pane
And the composer is visible (not blocked by the loading state)
```

### Scenario 9 — Stable tiebreak when two items share the same createdAt

```
Given two TimelineItems (item A and item B) have identical createdAt values
And item A has a lower id value than item B
When the unified feed is computed
Then item A appears before item B in the feed
And the order is deterministic across re-renders
```

### Scenario 10 — Activity serializer includes `via`

```
Given an ActivityLog row in the database has via = "cli"
When GET /api/issues/:key/activity is called
Then the response JSON for that row includes "via": "cli"
```

### Scenario 11 — Activity serializer passes through `via = null`

```
Given an ActivityLog row has via = null (pre-provenance row)
When GET /api/issues/:key/activity is called
Then the response JSON for that row includes "via": null
```

### Scenario 12 — Single composer; no embedded composer in CommentList

```
Given the issue detail page is rendered
When the DOM is inspected
Then exactly one comment compose form exists (the bottom-bar composer)
And no compose form is present inside the CommentList / timeline scroll area
```

### Scenario 13 — TypeScript kind narrowing

```
Given a value of type TimelineItem
When the code narrows on item.kind === "state-change"
Then TypeScript statically knows the item has fields: from, to, actor
And no cast or type assertion is required
```

### Scenario 14 — Unknown `via` value renders no badge

```
Given a TimelineItem has via = "some-future-tool" (not in the recognized set)
When that item is rendered
Then no via badge is rendered
```

---

## 5. Data Flow Summary

```
GET /api/issues/:key/comments  ─┐
                                 ├─► useUnifiedTimeline(issueKey)
GET /api/issues/:key/activity  ─┘      │
                                        │  merge + sort by createdAt ASC
                                        │  (tiebreak: id ASC)
                                        ▼
                               TimelineItem[]
                                        │
                                        ▼
                               UnifiedTimeline
                               ┌─────────────────────────┐
                               │  [item] [via badge?]     │ ← oldest
                               │  [item] [via badge?]     │
                               │  ...                     │
                               │  [item] [via badge?]     │ ← newest
                               └─────────────────────────┘
                               ┌─────────────────────────┐
                               │  [bottom-bar composer]   │ ← pinned
                               └─────────────────────────┘
```

---

## 6. Out-of-Scope Confirmation (for verify phase)

The following artifacts are NOT required by this spec and MUST NOT be flagged missing:

- A new `/api/issues/:key/timeline` endpoint
- Modifications to `AgentThread`
- SSE or WebSocket subscriptions on the issue page
- Pagination parameters on comments or activity queries
- Database migrations or backfill scripts for `via`
- Changes to comment edit or delete flows

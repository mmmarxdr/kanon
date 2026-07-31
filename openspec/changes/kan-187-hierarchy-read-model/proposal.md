# Proposal: KAN-187 Slice 2 — Hierarchy read-model

## Intent

Give the board a full-project issue set (including descendants) and a pure,
defensive forest builder so Slice 3 can expand hierarchy without ever rendering
parents and children as duplicate flat cards. Default board cards remain
**roots only**; the toolbar distinguishes root cards from total issues.

## Motivation

- Slice 1 unblocked MCP reparenting; the board still fetches `parent_only=true`.
- Dropping `parent_only` without a forest would flatten every child into columns
  (rejected Option A).
- `parentId` already rides on list responses and `issueSchema`; the gap is
  client fetch + tree construction.

## Scope

### In Scope
- **web**: `useIssuesQuery` fetches all project issues (omit `parent_only`).
- **web**: Pure `buildIssueForest` (roots, orphans-as-roots, cycle/depth guards,
  descendant counts).
- **web**: Board page passes forest roots to Kanban/Grouped; toolbar shows
  `roots · total issues · active`.
- Tests for forest builder + updated URL assertion.
- OpenSpec for this slice.

### Out of Scope
- Disclosure / nested child rows UI (Slice 3).
- Parent breadcrumb / SSE detail invalidation (Slice 4).
- API ancestry validation (Slice 5).
- Changing group summary API.

## Approach (settled)

- Single query key `issueKeys.list(projectKey)` now means **all issues**;
  invalidate paths stay unchanged.
- Forest is derived client-side; max render depth constant (8).
- Orphans (missing parent) and cycle participants surface as roots — never
  recurse infinitely.
- Grouped and flat modes both receive **root cards only** this slice
  (descendant rows come in Slice 3).

## Success Criteria

- [ ] Board fetch URL has no `parent_only`.
- [ ] With a root→child→grandchild fixture, board columns still show only the root.
- [ ] Toolbar reports both root count and total issue count.
- [ ] Forest builder tests cover nest, orphan, cycle, depth cap, descendantCount.

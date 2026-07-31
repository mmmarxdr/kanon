# Exploration: KAN-187 — Parent/subtask discoverability

> Grounded in worktree `kan-187-hierarchy` @ `origin/main` (`0a6829a`).
> Diagnosis in the ticket remains accurate; this note re-validates each claim
> against current code and locks the slice order before implementation.

## 1. Reproduced product failure (still true)

Board list always requests roots only:

```ts
// packages/web/src/features/board/use-issues-query.ts
`/api/projects/${projectKey}/issues?parent_only=true`
```

API maps that to `where.parentId = null` (`service.ts`). Nested issues under
KAN-127 → KAN-194 → KAN-195..198 therefore never appear as board cards, while
palette search (`q=` without `parent_only`) still finds them.

Grouped drill-down (`?group_key=`) and group summaries do **not** use
`parent_only`, so counts can include children the flat board hides.

## 2. Defect audit (current main)

| Claim | Status on main | Evidence |
|-------|----------------|----------|
| Board hides non-roots by design | **Confirmed** | `use-issues-query.ts` hardcodes `parent_only=true` |
| Palette finds descendants | **Confirmed** | search path omits `parent_only` |
| MCP `update_issue` drops `parentId` | **Confirmed** | `UpdateIssueInput` declares it; handler destructure in `issues.ts:133` omits it and never puts it on `body` |
| MCP `create_issue` forwards `parentId` | **OK** | `issues.ts:114` |
| Parent detail stale after child create | **Confirmed** | `use-domain-events` invalidates list/groups, not open `issueKeys.detail(parent)` |
| Palette search cache outside scoped invalidation | **Likely still true** | needs slice-4 verify against `issueKeys.search` |
| API update accepts `parentId` / null unlink | **Confirmed** | `UpdateIssueBody` + `service.ts` connect/disconnect |
| Same-project / cycle / self-parent validation | **Missing** | update connects by id with no ancestry checks |
| Detail has children, no parent breadcrumb | **Confirmed** | `getIssue` includes `children`, no parent summary |

### MCP update field parity (API `UpdateIssueBody` vs MCP)

| Field | API | MCP schema | MCP handler forwards |
|-------|-----|------------|----------------------|
| title | yes | yes | yes |
| description | yes | yes | yes |
| type | yes | **no** | no |
| priority | yes | yes | yes |
| assigneeId | yes | yes | yes |
| cycleId | yes | yes | yes |
| parentId | yes | yes | **no** (bug) |
| labels | yes | yes | yes |
| groupKey | yes | **no** | no |
| roadmapItemId | yes | yes | yes |

## 3. Alternatives considered (board visibility)

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| A. Drop `parent_only` — flat all issues | Instant visibility | Duplicate cards, ambiguous drag, loses hierarchy | **Reject as sole fix** (ticket Non-Goal) |
| B. Roots + expandable descendants | Matches Linear-style hierarchy, keeps board density | Needs tree builder, count semantics, UX work | **Adopt for board UX slice** |
| C. Separate “All issues” audit mode only | Cheap | Does not fix “work looks lost” on default board | Follow-up / secondary |
| D. MCP-only fix | Unblocks agents reparenting | Does not fix board discoverability | **Ship first as Slice 1** — necessary, not sufficient |

## 4. Locked slice sequence

1. **MCP update passthrough** — forward `parentId` (+ `type`/`groupKey` parity); tests for reparent/unlink; ack only fields actually submitted.
2. **Hierarchy read-model** — all-issue fetch / tree input; mode-aware query keys; keep `parentId` on list items.
3. **Board UX** — disclosure + nested rows; consistent flat/grouped counts.
4. **Detail + realtime** — parent breadcrumb; targeted invalidation (parent detail, search).
5. **Integrity** — same-project, self/cycle/depth validation; safe render of legacy cycles.
6. **Planning semantics (follow-up)** — rollups, cycle membership, Gantt hierarchy.

Do **not** start Slice 2–3 until Slice 1 lands (agents still cannot reparent via MCP today).

## 5. ADR gate

No ADR from diagnosis alone. Candidate ADRs after Slice 2–3 settle:

- Board hierarchy query shape + max depth
- Count semantics (roots vs total vs descendants vs groups)
- Drag semantics for nested cards

## 6. Immediate Slice 1 scope

See sibling change `kan-187-mcp-update-field-parity/` (proposal/design/spec/tasks).
Runtime: `packages/mcp` only. No API/web changes in Slice 1.

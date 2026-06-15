# Proposal: KAN-111 — Server-backed command palette search + filters

## Intent

The command palette (`Cmd+K`) runs static commands and a client-side cache
filter — it cannot find issues the user hasn't already loaded, and it has no
notion of state, type, priority, or document presence. Users can't answer
"which issues in this project have an ADR?" or "show me done bugs" from the one
surface meant for fast navigation. This change makes the palette a real,
server-backed search over the **current project's** issues, with both
chip-driven and typed-token filtering, while leaving the existing commands
intact when there is no project context.

## Motivation

- Palette search is cache-only (`command-palette.tsx:35-58`) — it can't see
  un-loaded issues, so it's blind for any non-trivial project.
- No way to filter by document presence; "has ADR" is a recurring product need
  and the `IssueDocument`↔`Issue` relation already exists (no migration).
- The list endpoint (`GET /api/projects/:key/issues`) is exact-match only — no
  free-text `q`, no relation filter. The plumbing to extend it is all in place.

## Scope

### In Scope
- **api (G1)**: add `q` (Prisma `contains`, insensitive, over title + key) plus
  `has_documents` / `document_kind` relation filters to `IssueFilterQuery` and
  `listIssues`. `has:adr` ⇒ `documents: { some: { kind: 'adr' } }`.
- **api (G2)**: include `documentKinds: DocumentKind[]` (distinct kinds present)
  per issue in the list response via Prisma select/groupBy. No migration.
- **shared (G3)**: add `documentKinds` to `issueSchema`; export the `DocumentKind`
  enum; extract `IssueFilterQuery` Zod schema to `packages/shared` for api+web reuse.
- **web (G4)**: `issueKeys.search(projectKey, q, filters)` query key + a debounced
  (~200ms) `useIssueSearchQuery` hook via `fetchApiValidated`.
- **web (G5)**: token parser (`state:done has:adr type:bug priority:high`) +
  chip UI (reuse `FilterChipSelect`/`SearchChip`) wired into the palette;
  leftover free text ⇒ `q`. ONE filters object as single source of truth.
- **web (G6)**: `Issue` type gains `documentKinds`; palette shows an ADR/doc indicator.
- Tests (strict TDD) at every layer: api filter/response, shared schema, web parser + hook.

### Out of Scope (follow-ups)
- **Workspace-wide search** — palette scope is the current project; no new
  cross-project endpoint. (Follow-up.)
- **Board-card document badge** — the `documentKinds` field is exposed but only
  the palette consumes it here. (Follow-up.)
- **Pagination / FTS** — `contains` is sufficient at current scale; full-text
  search and paged results are deferred. (Follow-up.)
- **schema.prisma changes** — none; runs parallel to KAN-102 on an independent
  worktree/PR.

## Capabilities

### New Capabilities
- `palette-issue-search`: server-backed issue search in the command palette
  scoped to the current project, with debounced free-text `q`, hybrid
  chip + typed-token filters (state / type / priority / document presence),
  and a document indicator on results.

### Modified Capabilities
- None. (The list endpoint is extended additively; existing exact-match filters
  and `include:{assignee}` behavior are preserved.)

## Approach (settled decisions — locked by ADR)

- **Current-project scope.** Palette derives `projectKey` from the route and
  calls the existing `GET /api/projects/:key/issues`; no project context ⇒
  commands still work, search degrades gracefully.
- **Additive list endpoint.** Extend `IssueFilterQuery` + `listIssues`; `q` uses
  `contains` (insensitive) on title + key; document presence is a `some` relation
  filter. `documentKinds` returned via select/groupBy. No migration (relation exists).
- **Shared single source of truth.** `documentKinds` + `DocumentKind` + the
  `IssueFilterQuery` Zod schema move to `packages/shared`, consumed by both api
  (query validation) and web (`fetchApiValidated`). Build `shared` before web tsc.
- **Hybrid filter UX, one filters object.** Chips are the primary control; typed
  tokens parse into the SAME object; leftover text ⇒ `q`. No divergent state.
- **Server is the source of truth.** Debounced (~200ms) React Query keyed by
  `issueKeys.search(projectKey, q, filters)`; results come from the server, not
  the client cache.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/shared/src/issue.ts` | Modified | `documentKinds` on `issueSchema`; export `DocumentKind`; extract `IssueFilterQuery` |
| `packages/api/src/modules/issue/schema.ts` | Modified | `q` + `has_documents` + `document_kind` in `IssueFilterQuery` |
| `packages/api/src/modules/issue/service.ts` | Modified | `listIssues`: `contains` search, relation filter, `documentKinds` select/groupBy |
| `packages/api/src/modules/issue/routes.ts` | Modified | Pass new query params through to service |
| `packages/web/src/types/issue.ts` | Modified | `Issue` gains `documentKinds` |
| `packages/web/src/lib/query-keys.ts` | Modified | `issueKeys.search(projectKey, q, filters)` |
| `packages/web/src/features/board/use-issues-query.ts` | Modified | New debounced `useIssueSearchQuery` hook |
| `packages/web/src/components/command-palette.tsx` | Modified | Token parser + chip UI + doc indicator; keyboard nav preserved |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Shared schema drift breaks api+web tsc | Med | Build `packages/shared` before web; Zod at both boundaries |
| `documentKinds` select/groupBy adds query cost | Med | Distinct-kind aggregation only; no per-doc fan-out; current-project scope bounds rows |
| Token parser conflicts with free-text `q` | Med | One filters object; known tokens parsed, remainder ⇒ `q`; unit-tested |
| Palette keyboard nav / aesthetic regresses | Med | Reuse `FilterChipSelect`/`SearchChip` primitives; render-test nav |
| No project context (e.g. workspace route) | Low | Graceful degrade — commands run, search hidden/disabled |
| Parallel KAN-102 edits collide | Low | No schema.prisma changes here; independent worktree + PR |

## Rollback Plan

No Prisma migration, no schema/data change. Rollback = revert the commits.
API stops accepting `q`/document filters (additive, so existing callers
unaffected); web palette reverts to the cache-only filter. Shared exports are
additive — reverting removes them with no data impact. No cleanup required.

## Dependencies

- None new. Reuses the existing `IssueDocument`↔`Issue` relation, the list
  endpoint, React Query, and `primitives.tsx` filter components.

## Success Criteria

- [ ] Palette finds project issues not yet in the client cache (server-backed `q`).
- [ ] `state:done has:adr type:bug priority:high` tokens + chips both drive one
      filters object; leftover text becomes `q`.
- [ ] "has ADR" returns only issues with `documents.some.kind = 'adr'`.
- [ ] Each result carries `documentKinds`; palette shows an ADR/doc indicator.
- [ ] No project context ⇒ commands still work, search degrades gracefully.
- [ ] No schema.prisma migration; all layers covered by strict-TDD tests.

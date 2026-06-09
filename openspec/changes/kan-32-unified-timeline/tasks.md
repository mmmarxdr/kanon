# Tasks: KAN-32 — Unified Issue Timeline

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines (prod) | 320–400 |
| Estimated test lines | 220–280 |
| 400-line budget risk | **Medium-High** |
| Chained PRs recommended | Optional (single PR preferred; split available) |
| Decision needed before apply | **Yes** — confirm single PR vs split |

**Suggested split if budget exceeded:**
- **PR 1 — data layer (additive, harmless alone):** activity serializer `+via`, web types `+via`, `timeline-types.ts`, `use-unified-timeline.ts` (+ `mergeTimeline` tests), `via-badge.tsx` (+ tests). ~250 lines.
- **PR 2 — UI integration:** `unified-timeline.tsx` (+ tests), `issue.tsx` tab collapse, `comment-list.tsx` composer removal, delete `tabs-section.tsx`. ~250 lines.

PR 1 is purely additive (no behavior change visible) so stacked-to-main is safe.

---

## Strict TDD — RED before GREEN on every code task.
Web runner: `pnpm --filter @kanon/web test`. API runner: `cd packages/api && pnpm vitest run`.

## Task list

### Phase A — API + types foundation
- [x] A1. **(RED)** Add serializer test: `serializeActivityLog` passes through `via="cli"` and `via=null` (Scenarios 10, 11). File: `packages/api/src/modules/activity/__tests__/serializer.test.ts` (or existing serializer test).
- [x] A2. **(GREEN)** Add `via: string | null` to `SerializedActivityLog` interface + `via: log.via ?? null` to `serializeActivityLog()` return. Verify `RawActivityLog` carries `via` (add to the type if hand-written; confirm the activity `findMany` has no `select` excluding it).
- [x] A3. Add `via: string | null` to web `Comment` and `ActivityLog` types (`packages/web/src/types/issue.ts`).

### Phase B — Merge logic (pure, TDD core)
- [x] B1. Create `packages/web/src/features/issue-detail/timeline-types.ts` — `TimelineItem` discriminated union + `Actor` (per design).
- [x] B2. **(RED)** `use-unified-timeline.test.ts` for pure `mergeTimeline(comments, activity)`:
  - interleaves by `createdAt` ASC (Scenario 1)
  - **drops `commented` activity rows** — no duplicate with the comment (design correction 2)
  - stable tiebreak: equal `createdAt` → lower `id` first via `localeCompare` (Scenario 9)
  - classifies comment `source` → `human-comment` vs `agent-comment` (AI sources = mcp, engram_sync, system, adr)
  - maps each `action` → correct kind (state_changed→state-change, created→created, assigned→assigned, edited→field-change, delete→deleted, document_added→document-added, unknown→field-change fallback)
- [x] B3. **(GREEN)** Implement `mergeTimeline` + `useUnifiedTimeline(issueKey)` hook in `use-unified-timeline.ts` (composes existing `useCommentsQuery` + `useActivityQuery`, `useMemo` merge, returns `{items, isLoading, isError}`).

### Phase C — ViaBadge
- [x] C1. **(RED)** `via-badge.test.tsx`: claude-code→"Claude Code" cobalt (S2); cursor/antigravity/cli labels (S3); via="web"→nothing (S4); via=null→nothing (S5); unknown value→nothing (S14).
- [x] C2. **(GREEN)** Implement `via-badge.tsx` — `VIA_LABELS` map, cobalt `oklch(0.52 0.11 245)` class, `Icon.Spark` from `@/components/ui/icons`. Render null for web/null/unknown.

### Phase D — UnifiedTimeline component
- [x] D1. **(RED)** `unified-timeline.test.tsx`: mixed feed renders all items oldest-first (S1); empty-state when no items (S7); loading state (S8).
- [x] D2. **(GREEN)** Implement `unified-timeline.tsx` — per-kind row renderer, mounts `<ViaBadge via={item.via}/>` on every row, empty/loading/error states.

### Phase E — IssuePage integration + cleanup
- [x] E1. Collapse Activity + Comments tabs in `routes/_authenticated/issue.tsx` into the single `UnifiedTimeline` panel; wire `useUnifiedTimeline(key)`. Keep the bottom-bar composer. **Do NOT touch AgentThread right pane.**
- [x] E2. Verify the comment mutation (`use-issue-mutations.ts`) invalidates BOTH comment + activity caches (Scenario 6); add the activity invalidation if missing.
- [x] E3. Remove the embedded compose form from `comment-list.tsx` (REQ-CM-02). If `CommentList` is now unused, delete it; verify importers first.
- [x] E4. Delete `tabs-section.tsx` (dead code, no importers — re-verify before delete).
- [x] E5. (If CommentList retained) integration assert: exactly one composer in DOM (Scenario 12). [N/A — CommentList deleted; single composer confirmed in issue.tsx bottom bar]

### Phase F — Verify gate
- [x] F1. Run full web + api test suites green.
- [x] F2. Typecheck web + api (no `via`-narrowing or union-exhaustiveness errors).
- [x] F3. Manual scope check vs non-goals (AgentThread untouched, no SSE, no /timeline endpoint, no migration).

---

## Dependency order
A → B → C → D → E → F. A is independent (API). B depends on A3 (types). C independent. D depends on B + C. E depends on D.

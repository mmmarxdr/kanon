# Tasks: KAN-187 Slice 2 — Hierarchy read-model

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~250–350 |
| 400-line budget risk | Low–Med |
| Chained PRs recommended | No |

### Phase 1 — Forest builder (STRICT TDD)

- [x] **1.1 RED** `build-issue-forest.test.ts` scenarios from spec
- [x] **1.2 GREEN** Implement `build-issue-forest.ts`
- [ ] **1.3 COMMIT** `feat(web): add buildIssueForest hierarchy helper`

### Phase 2 — Fetch + board wiring (STRICT TDD)

- [x] **2.1 RED** Update `use-issues-query` URL test (no parent_only)
- [x] **2.2 GREEN** Drop `parent_only`; wire forest in `board-page.tsx`; toolbar counts
- [x] **2.3** Board-page unit/smoke if cheap; else rely on forest + URL tests
- [ ] **2.4 COMMIT** `feat(web): board hierarchy read-model roots from all issues`
- [x] **2.5** `pnpm --filter @kanon/web exec vitest run` on touched tests

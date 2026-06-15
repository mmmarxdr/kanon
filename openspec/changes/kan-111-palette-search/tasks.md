# Tasks: KAN-111 — Server-backed command palette search + filters

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | PR1: ~250–320 · PR2: ~320–400 · Combined: ~570–720 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 (backend + shared) → PR2 (web wiring); PR2 pre-split into PR2a (utils+hooks+tests) / PR2b (palette UI + filter bar) if PR2 exceeds 400 lines |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Shared: documentKindSchema + IssueFilters + issueSchema.documentKinds | PR1 | Base: feat/kan-111; must build before api tsc |
| 2 | API: IssueFilterQuery ext + listIssues q/docs filters + documentKinds serialization | PR1 | Depends on unit 1; same PR1 commit chain |
| 3 | API + Shared tests (vitest) | PR1 | Same-commit per seam (strict TDD) |
| 4 | Web utils: parseSearchTokens, setFilterToken, buildIssueSearchParams, activeProjectKeyFromPath | PR2a | Base: PR1; pure fns + tests in same commits |
| 5 | Web hooks: issueKeys.search + useIssueSearchQuery + useActiveProjectKey | PR2a | Same PR2a; build shared before web tsc |
| 6 | Palette UI: PaletteFilterBar + command-palette rewrite + doc indicator + dead-code removal | PR2b | Base: PR2a; if PR2 fits in 400 lines, collapse PR2a+PR2b → PR2 |
| 7 | Web tests: hook, palette render, KAN-90 migration | PR2b | Same-commit per seam |

---

## PR1 — Backend + Shared (foundation)

> Base branch: `feat/kan-111-palette-search`. Must land before PR2. Build `@kanon/shared` before api tsc in CI.
> Satisfies: documentKinds per issue · q free-text · doc filters · IssueFilterQuery ext · Zod boundary (api).

### Phase 1.1 — Shared: DocumentKind enum + IssueFilters + issueSchema (STRICT TDD: schema tests first)

- [x] **1.1.1 RED** Write failing vitest in `packages/shared/src/__tests__/issue.test.ts`: assert `issueSchema` parses item WITH `documentKinds`, WITHOUT it (backward compat), and `documentKindSchema` rejects unknown kind. Run: `pnpm --filter @kanon/shared test`.
- [x] **1.1.2 GREEN** Add to `packages/shared/src/issue.ts`: `documentKindSchema = z.enum(['adr','pdr','rfc','note'])` + `type DocumentKind`; add `documentKinds: z.array(documentKindSchema).optional()` to the `z.object(...)` block (after `activeWorkers`, ~line 98); add `documentKinds?: DocumentKind[]` to the parallel manual `Issue` type (~line 119). Run shared tests — must pass.
- [x] **1.1.3 GREEN** Add to `packages/shared/src/issue.ts`: `issueFilterValueSchema = z.object({ state, type, priority, hasDocuments: z.boolean().optional(), documentKind: documentKindSchema.optional() })` + `export type IssueFilters`. Run shared tests — must pass.
- [x] **1.1.4** Export from `packages/shared/src/index.ts` barrel (~lines 60-83): add `documentKindSchema` to value-exports and `DocumentKind`, `issueFilterValueSchema`, `IssueFilters` to type-exports from `./issue.js`. Run `pnpm --filter @kanon/shared build` — must succeed.
- [x] **1.1.5 COMMIT** `feat(shared): add DocumentKind enum, IssueFilters, documentKinds on issueSchema`

### Phase 1.2 — API: IssueFilterQuery extension + listIssues query logic (STRICT TDD: api tests first)

- [x] **1.2.1 RED** Write failing vitest tests in `packages/api/src/modules/issue/__tests__/issue.service.test.ts` (or existing test file) covering: (a) `q` matches by title insensitive; (b) `q` matches by key insensitive; (c) `document_kind=adr` returns only issues with `documents.some.kind='adr'`; (d) `has_documents=true` returns issues with ≥1 doc; (e) response items include `documentKinds: DocumentKind[]` (distinct); (f) `q` AND `document_kind` compose (AND semantics); (g) existing `state`/`type`/`keys` filters still work (regression). Run: `pnpm --filter @kanon/api test`.
- [x] **1.2.2 GREEN** Extend `packages/api/src/modules/issue/schema.ts` (~lines 76-92): add `q: z.string().optional()`, `has_documents: z.coerce.boolean().optional()`, `document_kind: documentKindSchema.optional()` to `IssueFilterQuery`. Import `documentKindSchema` from `@kanon/shared`. Run api tests.
- [x] **1.2.3 GREEN** Edit `packages/api/src/modules/issue/service.ts` `listIssues`: add `q` free-text predicate as `where.OR = [{title:{contains,mode:'insensitive'}},{key:{contains,mode:'insensitive'}}]` guarded by `q.trim().length > 0`. Add doc filters: `if document_kind → where.documents={some:{kind}}; else if has_documents → where.documents={some:{}}`. Extend `findMany` include: `documents:{select:{kind:true},distinct:['kind']}`. Destructure `documents` out of spread in `.map`, return `documentKinds: documents.map(d=>d.kind)`. Run api tests — all pass.
- [x] **1.2.4** Verify `routes.ts` requires no change (it passes `request.query` through; new optional fields in the querystring schema are auto-picked). Run `pnpm --filter @kanon/api test`.
- [x] **1.2.5 COMMIT** `feat(api): extend listIssues — q free-text, doc filters, documentKinds per issue`
- [x] **1.2.6 COMMIT** `test(api,shared): listIssues q+filter scenarios, issueSchema documentKinds` (if tests not already in prior commit — prefer same-commit per TDD seam)

---

## PR2a — Web utils + hooks (pure functions and data layer)

> Base branch: PR1 merged. Build `@kanon/shared` before web tsc. No UI changes in this slice.
> Satisfies: debounced server query · query key · token parser · params builder · route-key resolution.

### Phase 2.1 — Pure utils (STRICT TDD: tests first for each util)

- [x] **2.1.1 RED** Write table-driven vitest for `parseSearchTokens` in `packages/web/src/features/board/__tests__/parse-search-tokens.test.ts`: recognized prefixes (state/type/priority/has), invalid enum value falls to q, unknown prefix falls to q, partial `state:` no value falls to q, last-wins on repeat, mixed tokens + free text, empty input, `has:adr`→documentKind, `has:any`→hasDocuments, `has:doc`→hasDocuments. Also cover `setFilterToken` upsert (add new token), replace (same prefix), remove (clear value). Run: `pnpm --filter @kanon/web test`.
- [x] **2.1.2 GREEN** Create `packages/web/src/features/board/parse-search-tokens.ts`: pure `parseSearchTokens(raw: string): ParsedSearch` + `setFilterToken(raw, prefix, value | null): string`. Zero React. Import `IssueFilters` from `@kanon/shared`. Run web tests — pass.
- [x] **2.1.3 RED** Write vitest for `buildIssueSearchParams` in `packages/web/src/features/board/__tests__/build-issue-search-params.test.ts`: camelCase→snake_case mapping, omits undefined fields, `documentKind` → `document_kind`, `hasDocuments` → `has_documents`, `q` encoded with `encodeURIComponent`, `document_kind` takes precedence (when both set, only `document_kind` emitted). Run web tests.
- [x] **2.1.4 GREEN** Create `packages/web/src/features/board/build-issue-search-params.ts`: pure `buildIssueSearchParams(q: string, filters: IssueFilters): string`. Run web tests — pass.
- [x] **2.1.5 RED** Write vitest for `activeProjectKeyFromPath` in `packages/web/src/hooks/__tests__/use-active-project-key.test.ts`: board/roadmap/dependencies/cycles paths return projectKey, `/issue/KAN-1` → `KAN`, workspace/inbox/settings → null, trailing slashes, encoded chars. Run web tests.
- [x] **2.1.6 GREEN** Create `packages/web/src/hooks/use-active-project-key.ts`: export pure `activeProjectKeyFromPath(pathname: string): string | null` helper + `useActiveProjectKey()` hook wrapping `useLocation()`. Run web tests — pass.
- [x] **2.1.7 COMMIT** `feat(web): issueKeys.search, parseSearchTokens, setFilterToken, buildIssueSearchParams` → commit ad1c728
- [x] **2.1.8 COMMIT** `feat(web): useActiveProjectKey + useIssueSearchQuery` → commit d261c7c (combined with 2.2 work unit)

### Phase 2.2 — Query key + hook (STRICT TDD: tests first)

- [x] **2.2.1** Add `search` key to `packages/web/src/lib/query-keys.ts` `issueKeys` factory: `search: (projectKey, q, filters) => [...issueKeys.all, 'search', projectKey, q, filters] as const`. Verify nested under `.all` (no collision with `.list`).
- [x] **2.2.2 RED** Write vitest for `useIssueSearchQuery` in `packages/web/src/features/board/__tests__/use-issue-search-query.test.ts`: `enabled:false` when `projectKey` null; `enabled:false` when q empty AND no filters; debounce coalesces rapid input (advance timers, assert single fetch); result parsed by `issueListSchema` (mock `fetchApiValidated`). Run web tests.
- [x] **2.2.3 GREEN** Create `packages/web/src/features/board/use-issue-search-query.ts`: `useIssueSearchQuery(projectKey, q, filters)` with 200ms debounce on combined q+filters, `enabled` gating, `fetchApiValidated(..., issueListSchema)`, `placeholderData: prev => prev`. Import `buildIssueSearchParams`, `issueKeys.search`, `IssueFilters` from `@kanon/shared`. Run web tests — pass.
- [x] **2.2.4 COMMIT** `feat(web): useActiveProjectKey + useIssueSearchQuery (debounced, enabled-gated)` → commit d261c7c
- [x] **2.2.5 COMMIT** `test(web): useIssueSearchQuery debounce + enabled gating` → commit d261c7c (same work-unit commit)

---

## PR2b — Palette UI + filter bar + dead-code removal

> Base branch: PR2a merged. Requires `@kanon/shared` already built.
> Satisfies: hybrid chip+token filters · doc indicator · keyboard nav preserved · no-project fallback · KAN-90 migration.

### Phase 3.1 — Web-local Issue type + CommandItem update

- [ ] **3.1.1** Add `documentKinds?: DocumentKind[]` to web-local `Issue` type in `packages/web/src/types/issue.ts` (~line 32) using the existing `DocumentKind` literal at types/issue.ts:115. No cast needed — structurally identical to shared `DocumentKind`.
- [ ] **3.1.2** Add `documentKinds?: DocumentKind[]` to `CommandItem` interface in `packages/web/src/components/command-palette.tsx` (~lines 17-24). Populate from issue in the items-building `useMemo`.
- [ ] **3.1.3 COMMIT** `feat(web): add documentKinds to web-local Issue + CommandItem`

### Phase 3.2 — PaletteFilterBar component (STRICT TDD: render test first)

- [ ] **3.2.1 RED** Write vitest render test in `packages/web/src/components/__tests__/palette-filter-bar.test.tsx`: chip renders with correct options, clicking a chip calls `onFilterChange`, clearing chip calls with undefined. Run web tests.
- [ ] **3.2.2 GREEN** Create `packages/web/src/components/palette-filter-bar.tsx`: presentational component wrapping `FilterChipSelect` (or `SearchChip`) for state/type/priority/documentKind chips. Props: `filters: IssueFilters, onFilterChange: (key, value) => void`. Pure presentation — no internal state. Run web tests — pass.
- [ ] **3.2.3 COMMIT** `feat(web): PaletteFilterBar — chip filter row for command palette`
- [ ] **3.2.4 COMMIT** `test(web): PaletteFilterBar chip interactions`

### Phase 3.3 — CommandPalette rewrite (STRICT TDD: render + nav tests first)

- [ ] **3.3.1 RED** Write/update vitest render tests in `packages/web/src/components/__tests__/command-palette.test.tsx`: (a) keyboard nav — arrow keys move through server results, Enter activates, Esc closes; (b) doc indicator renders when `documentKinds` non-empty (ADR badge visible), not rendered when `documentKinds=[]`; (c) no-project: search hidden/disabled, actions (Create issue, Go to board) still render and are reachable via keyboard; (d) KAN-90 migration: mock `useIssueSearchQuery` returning fixtures instead of testing cache-shape logic (remove `getQueriesData` premises). Run web tests (expect failures).
- [ ] **3.3.2 GREEN** Rewrite `packages/web/src/components/command-palette.tsx`: replace `aggregateIssuesFromQueries`/`getQueriesData` aggregation with `useActiveProjectKey()` + `useIssueSearchQuery(projectKey, q, filters)`; wire `raw` state + `parseSearchTokens` useMemo; render `PaletteFilterBar` with write-through `setFilterToken` on chip change; map `searchResults` in the items `useMemo` (preserving Section/Row/keyboard nav, selectedIndex logic, Enter→navigate, slice cap); add doc indicator in `Row` right slot using `documentKinds`; fix Go-to-Board to use `useActiveProjectKey()`. Keep overlay, input, nav, Section, Row UNCHANGED in shape. Run web tests — pass.
- [ ] **3.3.3 COMMIT** `feat(web): palette — server search, filter bar, doc indicator, keyboard nav preserved`
- [ ] **3.3.4 COMMIT** `test(web): palette render — nav, doc indicator, no-project, KAN-90 migration`

### Phase 3.4 — Dead code removal + build verification

- [ ] **3.4.1** Verify `aggregate-issues.ts` has no callers other than the palette (grep `packages/web/src` for the import). If confirmed sole consumer: delete `packages/web/src/features/board/aggregate-issues.ts` and its existing test file. If another consumer exists: DO NOT delete — flag as follow-up.
- [ ] **3.4.2** Run full test suite: `pnpm --filter @kanon/shared test && pnpm --filter @kanon/api test && pnpm --filter @kanon/web test`. All green.
- [ ] **3.4.3** Run `pnpm --filter @kanon/shared build` then `pnpm --filter @kanon/web build` (or tsc). No type errors. Confirm `documentKinds` resolves from the built shared `dist`, not stale types.
- [ ] **3.4.4 COMMIT** `chore(web): remove dead aggregate-issues path (palette is now server-backed)`

---

## Build-order reference (encode in CI and local dev)

```
pnpm --filter @kanon/shared build   # always before api or web tsc
pnpm --filter @kanon/api test       # PR1 gate
pnpm --filter @kanon/shared test    # PR1 gate
pnpm --filter @kanon/web test       # PR2a+PR2b gate
```

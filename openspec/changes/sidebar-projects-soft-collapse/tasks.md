# Tasks: Sidebar projects soft-collapse

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~150–250 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | single-pr |
| Chain strategy | n/a |

Decision needed before apply: No
Chained PRs recommended: No
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Pure `selectVisibleProjects` + tests | PR1 | Strict TDD; no UI |
| 2 | `sidebar-store` expand preference + tests | PR1 | Same PR; localStorage key |
| 3 | AppSidebar sticky chrome + soft-collapse UI + tests | PR1 | Same PR; keep KAN-49 admin tests green |
| 4 | Manual notebook smoke | PR1 | Verify checklist only |

---

## PR1 — Web soft-collapse (single PR)

> Base branch: `feat/sidebar-projects-soft-collapse` (or equivalent).
> Web-only. Satisfies: sticky chrome · soft limit 8 · active pin · persist expand · admin regression.

### Phase 1.1 — Pure helper (STRICT TDD)

- [x] **1.1.1 RED** Create `packages/web/src/lib/__tests__/select-visible-projects.test.ts` covering: (a) alphabetical sort when no active key; (b) active key sorts first; (c) `total <= 8` returns all, `hiddenCount = 0` regardless of `expanded`; (d) collapsed + 18 → `visible.length === 8`, `hiddenCount === 10`; (e) expanded + 18 → all visible, `hiddenCount === 0`; (f) active pin: active not in natural first-8 still appears in collapsed window with `visible.length <= 8`; (g) empty input. Run: `pnpm --filter @kanon/web test`.
- [x] **1.1.2 GREEN** Implement `packages/web/src/lib/select-visible-projects.ts` with `PROJECTS_SOFT_LIMIT = 8` and `selectVisibleProjects` per design.md §3. Run web tests — new suite passes.
- [ ] **1.1.3 COMMIT** `feat(web): add selectVisibleProjects soft-collapse helper`

### Phase 1.2 — Store persistence (STRICT TDD)

- [x] **1.2.1 RED** Add/extend store tests (e.g. `packages/web/src/stores/__tests__/sidebar-store.test.ts`): default `projectsExpanded === false`; `toggleProjectsExpanded` flips and writes `kanon-sidebar-projects-expanded`; load from `"true"` on init (isolate localStorage). Run web tests.
- [x] **1.2.2 GREEN** Extend `packages/web/src/stores/sidebar-store.ts` with `projectsExpanded`, `toggleProjectsExpanded`, load/save helpers mirroring `kanon-sidebar-collapsed`. Run web tests — pass.
- [ ] **1.2.3 COMMIT** `feat(web): persist sidebar projectsExpanded preference`

### Phase 1.3 — AppSidebar layout + soft-collapse UI (STRICT TDD)

- [x] **1.3.1 RED** Extend `packages/web/src/components/__tests__/app-sidebar.test.tsx`: (a) 18 mocked projects + collapsed preference → `Show all (18)` and ≤8 name rows; (b) click Show all → all names present + `Show less`; (c) active pin: route project among visible when collapsed; (d) with 18 projects + `isSuperAdmin`/`isInstanceAdmin`, Admin / New workspace / Logout still in document; (e) ≤8 projects → no Show all; (f) existing KAN-49 admin-flag cases still pass; (g) Projects `+` still opens create modal. Mock `projectsExpanded` / toggle from sidebar-store. Run web tests — new cases fail.
- [x] **1.3.2 GREEN** Restructure `packages/web/src/components/app-sidebar.tsx` into ChromeTop / ProjectsRegion / ChromeBottom per design.md §2; wire `selectVisibleProjects` + store; add Show all / Show less quiet text button; remove unbounded spacer pattern. Soft-collapse chrome only when `!collapsed`. Run web tests — all pass.
- [ ] **1.3.3 COMMIT** `feat(web): soft-collapse sidebar projects with sticky chrome`

### Phase 1.4 — Manual smoke (verify)

- [ ] **1.4.1** Manual: notebook-height viewport (~768–900px), workspace with ≥18 projects — confirm Admin / New workspace / Logout visible; projects region scrolls; Show all / Show less works; reload keeps preference.
- [ ] **1.4.2** Manual: aesthetic check — no new cards/pills; tokens match existing rail; icon-rail collapsed mode unchanged.
- [ ] **1.4.3** Run full web suite: `pnpm --filter @kanon/web test`.

---

## Verify checklist (post-apply)

- [ ] Every Given/When/Then in `specs/sidebar-project-list/spec.md` mapped to a test or manual smoke
- [ ] No `packages/api`, `packages/mcp`, or `packages/shared` diffs
- [ ] KAN-49 admin-flag tests green
- [ ] Rollback = revert PR commits (no migration)

# Proposal: Sidebar projects soft-collapse

## Intent

When a workspace has many projects (~18+), the AppSidebar renders every project
inline with no scroll budget. On notebook viewports the list pushes Admin /
New workspace / Logout below the fold, and the sidebar's `overflow: hidden`
clips them permanently. This change restructures the sidebar into sticky chrome
plus a soft-collapsed, scrollable projects region so bottom affordances stay
reachable and large project lists stop saturating the rail.

## Motivation

- Deployed/test workspaces routinely accumulate many projects; showing all of
  them at once is visually dense and feels unfinished.
- Notebook heights (~768–900px) cannot fit header + nav + 18 project rows +
  admin + user. Today the footer is unreachable — a functional regression for
  instance admins and logout.
- Root cause is structural: [`app-sidebar.tsx`](packages/web/src/components/app-sidebar.tsx)
  grows the projects list unbounded inside a column with `overflow: hidden`,
  then relies on a `flex: 1` spacer that collapses to zero under pressure.

## Scope

### In Scope
- **web (G1)**: Restructure `AppSidebar` into sticky top chrome (header, search,
  primary nav), a flex-growing projects region (`min-height: 0`,
  `overflow-y: auto`), and sticky bottom chrome (admin affordances + user row).
- **web (G2)**: Soft-collapse the projects list when `count > SOFT_LIMIT` (8):
  show ≤8 rows + `Show all (N)`; expanded state shows all + `Show less`.
- **web (G3)**: Ordering — active route project first, then alphabetical by name;
  active project always appears in the collapsed visible set (pin).
- **web (G4)**: Persist expand/collapse preference in `sidebar-store` via
  `localStorage` key `kanon-sidebar-projects-expanded`.
- **web (G5)**: Pure helper `selectVisibleProjects` + vitest coverage; extend
  `app-sidebar` component tests for soft-collapse and sticky-footer guarantees.
- Soft-collapse UI applies only when the sidebar is expanded (not icon-rail).

### Out of Scope (follow-ups)
- **Inline project filter** — Pattern C (filter by name/key when expanded).
- **Favorites / recency ranking** — no new API fields or “recent projects”.
- **Workspace switcher redesign** — header still shows static “Kanon / workspace”.
- **API / MCP / shared schema** — none; projects already come from
  `useProjectsQuery`.
- **Collapsed icon-rail soft-collapse chrome** — monogram list stays as today.

## Capabilities

### New Capabilities
- `sidebar-project-list`: sticky-chrome sidebar layout with soft-collapsed,
  scrollable project list, active-project pin, and persisted expand preference.

### Modified Capabilities
- None. Admin-flag visibility rules from KAN-49 are preserved; only layout and
  project-list density change.

## Approach (settled decisions — locked)

- **Pattern B — Soft collapse.** Default collapsed window of 8; expand in place.
  No inline filter in this change.
- **Sticky chrome.** Header, search, primary nav, admin block, and user row are
  outside the scroll container; only the projects region scrolls.
- **SOFT_LIMIT = 8.** Constant shared by helper and UI.
- **Active-first + alpha.** Sort active key first, then `localeCompare` on
  name for the remainder. Collapsed window = first 8 of that order, so the
  active project is always visible when it exists.
- **Persistence.** Same localStorage pattern as `kanon-sidebar-collapsed`.
- **Aesthetics.** Reuse existing CSS tokens; quiet text control for
  Show all / Show less; no new cards, pills, or decorative chrome.
- **Web-only, single PR.** Estimated ~150–250 changed lines; no chain.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/web/src/components/app-sidebar.tsx` | Modified | Sticky chrome layout + soft-collapse projects UI |
| `packages/web/src/stores/sidebar-store.ts` | Modified | `projectsExpanded` + toggle + localStorage |
| `packages/web/src/lib/select-visible-projects.ts` (new) | Added | Pure soft-limit / pin / sort helper |
| `packages/web/src/components/__tests__/app-sidebar.test.tsx` | Modified | Soft-collapse, pin, footer-visible scenarios |
| `packages/web/src/lib/__tests__/select-visible-projects.test.ts` (new) | Added | Unit tests for visible-set algorithm |
| `packages/web/src/stores/__tests__/sidebar-store.test.ts` (new or extend) | Added | Persist expand preference |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Footer still clips if nav grows later | Low | Projects region is the only `flex:1 min-height:0` scroll; chrome stays flex-shrink:0 |
| Soft limit hides active project | Low | Pin algorithm guarantees active key in visible set |
| Expand preference surprises multi-device users | Low | Per-browser localStorage only; default collapsed |
| Aesthetic drift from existing rail | Med | Reuse tokens + quiet mono control; no new surfaces |
| Admin-flag regression | Low | Keep existing KAN-49 tests green |

## Rollback Plan

No Prisma migration, no API change. Rollback = revert the web commits.
Sidebar returns to unbounded project list + spacer layout. localStorage key
`kanon-sidebar-projects-expanded` becomes inert; no cleanup required.

## Dependencies

- None new. Reuses `useProjectsQuery`, `useSidebarStore`, existing admin flags
  on `/me`, and current project-row markup/tokens.

## Success Criteria

- [ ] On a ~768–900px-tall viewport with 18 projects, Admin (if entitled),
      New workspace (if entitled), and Logout remain visible without scrolling
      the whole sidebar.
- [ ] With >8 projects and collapsed preference, UI shows ≤8 rows +
      `Show all (N)`; expand shows all + `Show less`.
- [ ] Active project is always in the visible set when collapsed.
- [ ] Expand preference survives reload via localStorage.
- [ ] Existing admin-flag sidebar tests continue to pass.
- [ ] No api/mcp/shared changes.

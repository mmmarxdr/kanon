# Design: Sidebar projects soft-collapse

> Technical design (the HOW). Product decisions are LOCKED by the proposal:
> Pattern B soft collapse, SOFT_LIMIT = 8, sticky chrome, active pin + alpha,
> localStorage expand preference, web-only. This document decides layout
> regions, the pure selection algorithm, store shape, a11y, aesthetics, and
> test seams. Grounded in `packages/web/src/components/app-sidebar.tsx` and
> `packages/web/src/stores/sidebar-store.ts`.

## 1. Architecture overview

Web-only. No API, MCP, or shared-schema changes. Projects already arrive via
`useProjectsQuery(workspaceId)`.

```
┌─ AppSidebar (column, height:100%, overflow:hidden) ──────────────────────┐
│ ┌─ ChromeTop (flex-shrink:0) ──────────────────────────────────────────┐ │
│ │ Workspace header · Search · Primary nav                              │ │
│ └──────────────────────────────────────────────────────────────────────┘ │
│ ┌─ ProjectsRegion (flex:1, min-height:0, overflow-y:auto) ─────────────┐ │
│ │ "PROJECTS" label + New project (+)                                   │ │
│ │ visible rows from selectVisibleProjects(...)                         │ │
│ │ Show all (N) / Show less  (when total > SOFT_LIMIT)                  │ │
│ └──────────────────────────────────────────────────────────────────────┘ │
│ ┌─ ChromeBottom (flex-shrink:0) ───────────────────────────────────────┐ │
│ │ Admin affordances (conditional) · User row (avatar / profile / logout)│ │
│ └──────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

The previous `flex: 1` spacer between projects and admin is **removed**. The
projects region itself is the growing/shrinking middle.

Collapsed icon-rail (`collapsed === true`): keep today's monogram-only project
icons with no Show all / Show less chrome. Soft-collapse applies only when
expanded.

## 2. Layout contract

### 2.1 Regions

| Region | Contents | Flex | Overflow |
|--------|----------|------|----------|
| ChromeTop | Header (44px), search trigger, primary nav | `flex-shrink: 0` | visible |
| ProjectsRegion | Projects label + soft list + toggle | `flex: 1; min-height: 0` | `overflow-y: auto` |
| ChromeBottom | Admin block (if any) + user row | `flex-shrink: 0` | visible |

Aside keeps `height: 100%`, `overflow: hidden`, width transition unchanged
(232 / 56).

### 2.2 Why this fixes notebook clipping

Today every project row is a non-shrinking sibling above the spacer. When
content height exceeds the viewport, `overflow: hidden` clips ChromeBottom.
Making ProjectsRegion the only `flex: 1; min-height: 0` child forces it to
absorb surplus height and scroll internally, so ChromeBottom stays painted.

### 2.3 Scroll styling

- Thin scrollbar preferred (match existing app scrollbars if any; otherwise
  browser default is acceptable).
- Expanding from 8 → all MUST NOT move ChromeBottom; only the scrollable
  region's content height changes.
- No nested scroll on ChromeTop or ChromeBottom.

## 3. Soft-limit algorithm

### 3.1 Pure helper

New file: `packages/web/src/lib/select-visible-projects.ts`

```ts
export const PROJECTS_SOFT_LIMIT = 8;

export interface SoftProject {
  id: string;
  key: string;
  name: string;
}

export interface SelectVisibleProjectsInput {
  projects: SoftProject[];
  activeKey: string;      // "" when no route project
  softLimit?: number;     // default PROJECTS_SOFT_LIMIT
  expanded: boolean;
}

export interface SelectVisibleProjectsResult {
  visible: SoftProject[];
  hiddenCount: number;
  total: number;
}

export function selectVisibleProjects(
  input: SelectVisibleProjectsInput,
): SelectVisibleProjectsResult;
```

### 3.2 Steps (normative)

1. **Sort**: copy array. Partition active (`p.key === activeKey`) to the front
   (stable among actives — at most one). Sort the remainder by
   `name.localeCompare(other, undefined, { sensitivity: "base" })`.
2. **Expand short-circuit**: if `expanded === true` OR `total <= softLimit`,
   return `{ visible: sorted, hiddenCount: 0, total }`.
3. **Collapse window**: take first `softLimit` of sorted as candidate window.
4. **Active pin**: if `activeKey` is non-empty, the active project exists in
   `projects`, and it is not already in the candidate window, replace the last
   window slot with the active project (after removing any duplicate). This
   keeps `visible.length <= softLimit` and guarantees presence.
5. Return `{ visible, hiddenCount: total - visible.length, total }`.

### 3.3 UI binding

- Render `visible` as today's project rows (same markup/tokens).
- When `total > softLimit && !expanded`: render control
  `Show all ({total})` that calls `toggleProjectsExpanded()`.
- When `total > softLimit && expanded`: render control `Show less`.
- When `total <= softLimit`: no toggle control.
- Label copy is exact: `Show all (N)` / `Show less` (N = total count).

## 4. Store shape

Extend `packages/web/src/stores/sidebar-store.ts`:

```ts
interface SidebarState {
  collapsed: boolean;
  toggleSidebar: () => void;
  projectsExpanded: boolean;
  toggleProjectsExpanded: () => void;
  setProjectsExpanded: (expanded: boolean) => void; // optional test seam
}
```

- Storage key: `kanon-sidebar-projects-expanded`
- Load: `"true"` → true; missing / error → **false** (default collapsed)
- Save: on toggle, write `String(next)` inside try/catch (same resilience as
  `kanon-sidebar-collapsed`)
- Independent of sidebar `collapsed` rail state

## 5. Component decomposition

Stay in `app-sidebar.tsx` for this change. Extract only the pure helper to
`lib/`. Optional internal fragments (not separate files unless needed):

- Projects header (label + `+`)
- Project row (existing inline JSX)
- Soft-collapse toggle button

Do **not** introduce new card wrappers, popovers, or portals.

## 6. Aesthetics (preserve rail language)

- Tokens only: `--bg-2`, `--bg-3`, `--bg`, `--line`, `--ink`, `--ink-2`,
  `--ink-3`, `--ink-4`, `--accent`, `--btn-ink`
- Projects section label stays `mono`, 10px, uppercase, `letterSpacing: 0.06em`
- Toggle control: quiet text button, ~11–12px, `color: var(--ink-4)`, hover
  → `var(--ink-3)`; no border, no fill, no pill
- Row height stays 26px; active treatment unchanged
- No new icons on the toggle (text only)

## 7. Accessibility

- Toggle is a real `<button type="button">` with accessible name matching
  visible label (`Show all (18)` / `Show less`).
- Projects region MAY set `aria-label="Projects"` on the scroll container.
- Keyboard: toggle reachable via Tab in natural order after the last visible
  project row; Enter/Space activates (native button).
- Focus must not be trapped inside the scroll region.
- Collapsed icon-rail: no toggle; project tooltips unchanged.

## 8. Empty / loading

Preserve current copy and placement:

- Loading: `Loading…` inside the projects region when `projectsLoading`
- Empty: italic `No projects` when loaded and `length === 0`
- Neither state shows Show all / Show less

## 9. Test seams

| Seam | File | Covers |
|------|------|--------|
| Pure algorithm | `lib/__tests__/select-visible-projects.test.ts` | sort, soft window, pin, expand, edge counts |
| Store persist | `stores/__tests__/sidebar-store.test.ts` | default false, toggle writes localStorage, load |
| Sidebar UI | `components/__tests__/app-sidebar.test.tsx` | 18 projects → Show all; expand; admin still in document; active pin; ≤8 no toggle; KAN-49 admin flags regression |

Layout “footer always visible” is asserted in component tests by presence of
logout / admin nodes in the document while 18 projects are mocked — not by
pixel measurement. Manual notebook smoke remains a verify-phase checklist item.

## 10. Sequence (user expands list)

```
User clicks "Show all (18)"
  → sidebar-store.toggleProjectsExpanded()
  → localStorage.setItem("kanon-sidebar-projects-expanded", "true")
  → AppSidebar re-renders
  → selectVisibleProjects({ expanded: true }) → all 18 visible
  → ProjectsRegion scrolls internally if needed
  → ChromeBottom unchanged in layout
```

## 11. Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| A — Sticky + scroll only (no soft collapse) | Fixes clipping but leaves 18-row density always on; user chose B |
| C — Soft collapse + inline filter | Better at 20+, deferred as follow-up to keep this PR small |
| Popover / command-palette project picker | Heavier interaction change; breaks current board-link muscle memory |
| Server-side recent projects | Requires API + ranking; out of scope |

## 12. PR slicing

Single PR, ~150–250 lines. No chain. Strict TDD order in `tasks.md`:
helper → store → sidebar UI.

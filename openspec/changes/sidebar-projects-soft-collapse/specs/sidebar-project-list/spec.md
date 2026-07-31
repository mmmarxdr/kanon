# sidebar-project-list Specification

## Purpose

Keep the AppSidebar usable when a workspace has many projects. The sidebar
MUST pin admin and user chrome at the bottom, soft-collapse the projects list
by default when it exceeds eight items, and let the user expand/collapse that
list without losing the active project from view.

---

## Requirements

### Requirement: Sticky chrome layout

The AppSidebar MUST be a full-height column that keeps top chrome (workspace
header, search trigger, primary navigation) and bottom chrome (admin
affordances when entitled, user row including Logout) outside any vertical
scroll container. The projects region MUST be the only middle section that
grows and scrolls (`flex: 1`, `min-height: 0`, `overflow-y: auto`). The
previous unbounded projects list + spacer pattern MUST NOT clip bottom chrome
when project count is large.

#### Scenario: Bottom chrome remains reachable with many projects

- GIVEN the sidebar is expanded and the workspace has 18 projects
- AND the user is an instance admin and/or super admin (flags as applicable)
- WHEN the sidebar renders at a constrained viewport height
- THEN Admin (if `isSuperAdmin`), New workspace (if `isInstanceAdmin`), and
  Logout remain present and reachable without scrolling the entire sidebar
- AND vertical scrolling, if any, occurs only inside the projects region

#### Scenario: Primary nav stays above the projects region

- GIVEN the sidebar is expanded
- WHEN the user views the rail
- THEN Inbox, Roadmap, Dependencies, Board, Cycles, Schedule, and Settings
  remain in the non-scrolling top chrome above Projects

---

### Requirement: Soft-collapse default window

When the sidebar is expanded, `projects.length > 8`, and the user's expand
preference is collapsed, the projects region MUST show at most eight project
rows and MUST show a control labeled `Show all (N)` where `N` is the total
project count. When `projects.length <= 8`, the UI MUST show all projects and
MUST NOT show a Show all / Show less control.

#### Scenario: More than eight projects — collapsed

- GIVEN the sidebar is expanded
- AND the workspace has 18 projects
- AND `projectsExpanded` is false
- WHEN the projects region renders
- THEN at most 8 project rows are visible
- AND a button labeled `Show all (18)` is visible

#### Scenario: Eight or fewer projects — no toggle

- GIVEN the sidebar is expanded
- AND the workspace has 5 projects
- WHEN the projects region renders
- THEN all 5 project rows are visible
- AND neither `Show all` nor `Show less` is shown

---

### Requirement: Expand and collapse

Activating `Show all (N)` MUST set the expand preference to true, reveal every
project in the scrollable projects region, and show a control labeled
`Show less`. Activating `Show less` MUST set the preference to false and
restore the soft-collapsed window. The preference MUST persist across reloads
via `localStorage` key `kanon-sidebar-projects-expanded` (default false).

#### Scenario: Expand reveals all projects

- GIVEN 18 projects and collapsed preference
- WHEN the user activates `Show all (18)`
- THEN all 18 project rows are available in the projects region
- AND the control label becomes `Show less`
- AND `localStorage["kanon-sidebar-projects-expanded"]` is `"true"`

#### Scenario: Collapse restores the soft window

- GIVEN 18 projects and expanded preference
- WHEN the user activates `Show less`
- THEN at most 8 project rows are visible
- AND the control label becomes `Show all (18)`
- AND `localStorage["kanon-sidebar-projects-expanded"]` is `"false"`

#### Scenario: Preference survives reload

- GIVEN the user previously expanded the projects list
- WHEN the app reloads and the sidebar mounts
- THEN the projects list renders expanded (all rows available)
- AND `Show less` is shown when total > 8

---

### Requirement: Ordering and active pin

Visible projects MUST be ordered with the active route project (matching
`projectKey` from the path) first, then remaining projects alphabetically by
name (case-insensitive). When soft-collapsed, if an active project would fall
outside the eight-row window, the UI MUST still include it in the visible set
(pin), keeping visible length ≤ 8.

#### Scenario: Active project sorts first

- GIVEN projects named Zebra (key `ZEB`) and Alpha (key `ALP`)
- AND the route project key is `ZEB`
- WHEN the list is rendered (collapsed or expanded)
- THEN Zebra appears before Alpha

#### Scenario: Active project pinned into collapsed window

- GIVEN more than 8 projects sorted alphabetically after the active pin rule
- AND the active project would not be among the first 8 without pinning
- AND preference is collapsed
- WHEN the projects region renders
- THEN the active project is among the visible rows
- AND at most 8 rows are visible

#### Scenario: No active project — pure alphabetical soft window

- GIVEN more than 8 projects and no route `projectKey`
- AND preference is collapsed
- WHEN the projects region renders
- THEN the first 8 alphabetically by name are shown
- AND `Show all (N)` is shown

---

### Requirement: Icon-rail collapsed mode

When the sidebar rail is collapsed (`collapsed === true`), the projects region
MUST continue to show monogram-only project affordances with tooltips as today
and MUST NOT show `Show all` / `Show less` controls. Soft-collapse chrome
applies only to the expanded sidebar.

#### Scenario: Collapsed rail hides soft-collapse controls

- GIVEN 18 projects and the sidebar rail is collapsed
- WHEN the sidebar renders
- THEN project monograms remain available
- AND neither `Show all` nor `Show less` is shown

---

### Requirement: Empty and loading states

While projects are loading, the projects region MUST show the existing
`Loading…` affordance (expanded sidebar). When loaded with zero projects, it
MUST show the existing italic `No projects` copy. Neither state MUST show
Show all / Show less.

#### Scenario: Loading

- GIVEN `useProjectsQuery` is loading
- AND the sidebar is expanded
- WHEN the projects region renders
- THEN `Loading…` is shown
- AND no Show all / Show less control is shown

#### Scenario: Empty workspace

- GIVEN projects loaded as an empty list
- AND the sidebar is expanded
- WHEN the projects region renders
- THEN `No projects` is shown
- AND no Show all / Show less control is shown

---

### Requirement: Admin affordance regression

Existing entitlement rules MUST be preserved: `isSuperAdmin` shows Admin and
Invite admin; `isInstanceAdmin` shows New workspace; both flags false shows
none of those entries. Soft-collapse MUST NOT change those visibility rules.

#### Scenario: Super admin still sees Admin

- GIVEN `user.isSuperAdmin === true` and 18 projects
- WHEN the sidebar renders expanded
- THEN the Admin nav entry linking toward `/admin/instance` is present

#### Scenario: Non-admin sees no admin block

- GIVEN both admin flags false and 18 projects
- WHEN the sidebar renders expanded
- THEN Admin, New workspace, and Invite admin are absent
- AND Logout remains present in the user row

---

### Requirement: Aesthetic and interaction constraints

The soft-collapse control MUST be a quiet text button using existing ink
tokens (no new card, pill, border, or filled chip). Project row markup and
active styling MUST remain visually consistent with the pre-change rail.
Creating a project via the Projects `+` control MUST continue to open the
existing create-project modal.

#### Scenario: New project control still works

- GIVEN the sidebar is expanded and a workspace is active
- WHEN the user activates the Projects `+` control
- THEN the create-project modal opens

---

## Out of Scope

- Inline project filter / typeahead inside the projects region
- Favorites, pinning UI, or server-side recency ranking
- Workspace switcher redesign in the header
- API, MCP, or `@kanon/shared` changes

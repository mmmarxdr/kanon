# Spec: Active workspace

## Capability: active-workspace

### Requirement: Persist and resolve active workspace

The client MUST persist the active workspace id and resolve it against the
user’s membership list before using it for projects, settings, inbox, or SSE.

#### Scenario: Select workspace B

- **GIVEN** the user belongs to workspaces A and B (A oldest)
- **WHEN** they select B on `/workspaces`
- **THEN** `useActiveWorkspaceId()` returns B
- **AND** the sidebar projects query uses B’s id

#### Scenario: Reload preserves selection

- **GIVEN** active workspace is B
- **WHEN** the page reloads
- **THEN** active workspace remains B

#### Scenario: Stale membership falls back

- **GIVEN** stored id is no longer in the workspace list
- **WHEN** workspaces load
- **THEN** active falls back to the first list entry and storage is rewritten

### Requirement: Quick switcher

#### Scenario: Popover switch navigates to inbox

- **GIVEN** the user is on a board in workspace A
- **WHEN** they pick B from the sidebar WorkspaceSwitcher
- **THEN** active workspace becomes B
- **AND** project list queries are invalidated
- **AND** the app navigates to `/inbox`

### Requirement: Create flow

#### Scenario: New workspace becomes active

- **GIVEN** an instance admin creates a workspace
- **WHEN** creation succeeds
- **THEN** the new workspace id is set as active before navigating to its project picker

# Profile Notification Preferences Specification

## Purpose

Defines relocation of workspace-scoped notification preferences from `/settings` to `/profile`, resolved via active-workspace context with a contextual label, its no-workspace empty state, and the token/accessibility fixes traveling with the component.

## Requirements

### Requirement: Notification Preferences Location

The system MUST render `NotificationPreferencesSection` on `/profile` and MUST NOT render it on `/settings`. The relocation MUST NOT change the component's read/write logic or the notification-preferences API contract.

#### Scenario: Profile shows preferences, Settings does not

- GIVEN a user with an active workspace opens `/profile`
- WHEN the page renders
- THEN notification-preferences controls appear on `/profile` and appear nowhere on `/settings`

#### Scenario: API contract unchanged

- GIVEN a user toggles a preference on `/profile`
- WHEN the mutation fires
- THEN it calls the same `PUT /api/workspaces/:id/notification-preferences` endpoint with the same request/response shape as before relocation

### Requirement: Workspace-Scoped Resolution

Preferences on `/profile` MUST be scoped to the current active workspace via `useActiveWorkspaceId()`, with a visible contextual label naming that workspace.

#### Scenario: Label names the active workspace

- GIVEN the user's active workspace is "Acme Corp"
- WHEN `/profile` renders preferences
- THEN a label reads e.g. "For workspace: Acme Corp"

#### Scenario: Preferences follow active-workspace changes

- GIVEN a user switches active workspace from "Acme Corp" to "Beta Inc" elsewhere in the app
- WHEN they open `/profile`
- THEN preferences and label reflect "Beta Inc", not "Acme Corp"

### Requirement: No-Workspace Empty State

When `useActiveWorkspaceId()` resolves to no workspace, or resolution is pending, `/profile` MUST render a defined empty/loading state instead of erroring or showing stale/broken controls.

#### Scenario: Zero-workspace user

- GIVEN a user belongs to no workspace
- WHEN they open `/profile`
- THEN the preferences area shows an explicit empty/disabled state, not an error or blank gap

#### Scenario: Resolution pending

- GIVEN active-workspace lookup has not resolved yet
- WHEN `/profile` first renders
- THEN the preferences area shows a loading state, not an error or broken toggle

### Requirement: Accessible Notification Toggle

Each toggle MUST expose an accessible name tying it to its adjacent label via `aria-label` or `aria-labelledby`.

#### Scenario: Screen reader announces name and state

- GIVEN a toggle for "Issue assigned to me"
- WHEN a screen reader focuses it
- THEN it announces "Issue assigned to me" with `role="switch"` and current `aria-checked` state

### Requirement: Token-Backed Profile Presentation

Profile save-success and password-change-success banners MUST use token-backed colors instead of hardcoded `border-green-500/50 bg-green-500/10 text-green-700`. The toggle's active-state knob MUST use a token-backed background instead of hardcoded `bg-white`.

#### Scenario: Success banners are tokenized

- GIVEN a user saves profile changes or changes their password
- WHEN the respective success banner renders
- THEN it uses token-backed colors with adequate dark-mode contrast, not hardcoded green

#### Scenario: Toggle knob is tokenized

- GIVEN a notification toggle is "on"
- WHEN the knob renders in light and dark mode
- THEN its background is a token-backed class, not hardcoded `bg-white`

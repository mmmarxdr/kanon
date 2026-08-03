# Delta for Profile Notification Preferences

## ADDED Requirements

### Requirement: Notification Toggle List Layout

Notification preference toggles on `/profile` MUST render inside `SettingsList`/`SettingsListRow` (or equivalent list composition) so each toggle row matches the density, column alignment, and ~48px row height of workspace member lists. Layout change MUST NOT alter preference keys, API calls, workspace scoping, or toggle accessibility semantics.

#### Scenario: Toggles use SettingsListRow

- GIVEN a user with an active workspace opens `/profile`
- WHEN notification preferences render
- THEN each preference appears as a list row with label/description and switch aligned to the shared list grid, not a compact `py-2 px-3` card row

#### Scenario: Workspace scoping unchanged

- GIVEN the user's active workspace is "Acme Corp"
- WHEN preferences render after list layout migration
- THEN the "For workspace: Acme Corp" label, active-workspace resolution, and `PUT /api/workspaces/:id/notification-preferences` contract behave exactly as before

#### Scenario: Toggle accessibility preserved

- GIVEN a toggle for "Issue assigned to me" in list row layout
- WHEN a screen reader focuses it
- THEN it still exposes `role="switch"`, an accessible name tied to its label, and correct `aria-checked` state

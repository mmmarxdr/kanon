# Settings List Layout Specification

## Purpose

Defines `SettingsList` and `SettingsListRow` primitives for scannable, column-aligned settings lists (members, invites, project members, notification toggles) with responsive collapse and i18n column headers.

## Requirements

### Requirement: Column Header Row

`SettingsList` MUST render a header row of column labels above its rows. Column labels MUST come from i18n keys (e.g. in `settings.json` for en/es) and MUST use subdued typography distinct from data rows.

#### Scenario: Members list shows column headers

- GIVEN the workspace Members section uses `SettingsList`
- WHEN the list renders on a `sm+` viewport
- THEN a header row displays localized labels for primary columns (e.g. member, email, joined, role, actions) above the data rows

#### Scenario: Headers localize

- GIVEN the user's locale is Spanish
- WHEN a settings list with column headers renders
- THEN header text comes from Spanish i18n keys, not hardcoded English

### Requirement: Row Height and Grid Alignment

`SettingsListRow` MUST align cells to a shared grid on `sm+` viewports with a minimum row height of approximately 48px. Primary text MUST use `text-sm font-medium`; secondary text MUST use `text-xs text-muted-foreground` on dedicated lines or columns.

#### Scenario: Member row meets density target

- GIVEN a member row renders inside `SettingsListRow` on desktop
- WHEN measured visually
- THEN the row is at least 48px tall, columns align with the header grid, and actions sit in a right-aligned actions column

#### Scenario: Invite row uses same grid language

- GIVEN an invite row renders in the Invites section
- WHEN viewed on `sm+`
- THEN it follows the same list/grid pattern as member rows (headers + aligned columns), not a compact two-line card row

### Requirement: Responsive Mobile Collapse

On viewports below `sm`, `SettingsList` MUST collapse non-essential columns and stack or inline remaining fields so rows remain readable and actions stay reachable without horizontal scroll.

#### Scenario: Narrow viewport hides secondary columns

- GIVEN a viewport below the `sm` breakpoint
- WHEN a members list renders
- THEN non-essential columns (e.g. joined date) MAY hide and primary identity plus actions remain accessible

#### Scenario: No horizontal overflow on mobile

- GIVEN any settings list on a narrow phone-width viewport
- WHEN the user scrolls the list vertically
- THEN the list does not introduce horizontal page scroll solely due to column layout

### Requirement: Shared List Adoption

Workspace members, workspace invites, project members, and profile notification toggles MUST use `SettingsList`/`SettingsListRow` (or a documented composition thereof) instead of bespoke flex row markup.

#### Scenario: Project members reuse list primitive

- GIVEN a user opens project settings members
- WHEN the member list renders
- THEN it uses the same list/header/row pattern as workspace Members, differing only in column set and actions

#### Scenario: Notification toggles use list rows

- GIVEN notification preferences on `/profile`
- WHEN toggles render
- THEN each preference appears as a `SettingsListRow` with label/description and switch in aligned columns, matching members list density

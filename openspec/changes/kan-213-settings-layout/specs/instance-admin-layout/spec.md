# Instance Admin Layout Specification

## Purpose

Defines layout and form structure for `/admin/instance`: `SettingsShell` adoption, two-column form grid, `SettingsField` primitive, unified `SettingsCard` language, and removal of the legacy 560px single-column form.

## Requirements

### Requirement: Instance Admin Shell

`/admin/instance` MUST render inside `SettingsShell` with title and super-admin eyebrow, MUST inherit the default fluid content width, and MUST NOT constrain the main form body to a fixed `560px` (or similar) max width.

#### Scenario: Admin page uses shared shell

- GIVEN a super-admin opens `/admin/instance`
- WHEN the page renders
- THEN it shows `SettingsShell` header chrome consistent with `/settings` and content width follows `min(1100px, 100%)`, not 560px

#### Scenario: No legacy skinny column

- GIVEN a wide desktop viewport
- WHEN Instance Admin loads
- THEN form content uses substantially more horizontal space than the pre-change 560px column

### Requirement: Two-Column Form Grid

Instance settings fields MUST use a responsive two-column grid at `md+` breakpoints: instance name full width; paired fields (signup mode + allowed domains, Redmine base URL + default email locale) side by side; single fields stack on narrow viewports.

#### Scenario: Paired fields on desktop

- GIVEN viewport is `md` or wider
- WHEN the instance settings form renders
- THEN signup mode and allowed signup domains appear on one row as two columns, and Redmine base URL and default email locale appear on another row as two columns

#### Scenario: Fields stack on mobile

- GIVEN viewport is below `md`
- WHEN the form renders
- THEN paired fields stack vertically in logical reading order without overlap or clipped labels

### Requirement: SettingsField Primitive

Instance Admin form labels and inputs MUST use a shared `SettingsField` (or equivalent) that matches Tailwind form styling used on Profile and workspace settings — not bespoke raw `var(--*)` inline field wrappers with mismatched radius, label size, or button styling.

#### Scenario: Field styling matches product forms

- GIVEN a text input on Instance Admin after migration
- WHEN compared to profile settings inputs
- THEN border radius, label typography, and focus/hover behavior are visually consistent with the shared form language

### Requirement: Unified Card Language

The invite-admin block and downstream sections (including `AdminRedmineSection`) MUST use `SettingsCard` (v2 where applicable) end-to-end. The invite-admin block MUST NOT use a bespoke `var(--bg-2)` inset panel visually distinct from other settings cards.

#### Scenario: Invite admin on SettingsCard

- GIVEN the invite-admin section renders
- WHEN viewed alongside workspace settings cards
- THEN it uses `SettingsCard` with title/description header, not a one-off admin panel style

#### Scenario: Redmine section matches card stack

- GIVEN `AdminRedmineSection` renders below the main form
- WHEN the user scrolls the page
- THEN both sections share the same card border, padding, and header language without an abrupt mid-page style change

### Requirement: Preserve Test Identifiers

Layout refactor MUST preserve existing `data-testid` attributes on Instance Admin form controls and actions relied upon by automated tests.

#### Scenario: Admin tests find controls after layout change

- GIVEN existing admin-instance tests query fields by `data-testid`
- WHEN the two-column layout ships
- THEN the same testIds remain on the corresponding inputs, selects, and buttons

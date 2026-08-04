# Settings Shell Specification

## Purpose

Defines shared page chrome (`SettingsShell`) for all settings-like routes: consistent header, scrollable body, and fluid content width so Settings, Project Settings, Profile, and Instance Admin read as one admin console.

## Requirements

### Requirement: SettingsShell Primitive

The system MUST expose a `SettingsShell` component that renders a page header (title, optional eyebrow, optional tab strip slot) and a scrollable body with an inner content wrapper defaulting to `max-width: min(1100px, 100%)`.

#### Scenario: Default shell renders header and fluid body

- GIVEN a route wraps its content in `SettingsShell` with `title="Settings"`
- WHEN the page renders on a viewport wider than 1100px
- THEN the header shows the title, the body scrolls independently, and content width caps at 1100px centered in the available main area

#### Scenario: Shell respects narrow viewports

- GIVEN a viewport narrower than 1100px
- WHEN `SettingsShell` renders
- THEN the inner content wrapper uses 100% of available width without horizontal overflow

### Requirement: Settings-Like Route Migration

The routes `/settings`, `/project-settings`, `/profile`, and `/admin/instance` MUST each render their page content inside `SettingsShell` and MUST NOT apply route-local `maxWidth` constraints that override the shell default.

#### Scenario: Four surfaces share shell chrome

- GIVEN a user navigates to each of the four routes in turn
- WHEN each page renders
- THEN all four show consistent shell header/body chrome and none retain legacy fixed caps such as `560px`, `720px`, or `max-w-lg` on the main content column

#### Scenario: Per-route maxWidth hacks removed

- GIVEN the layout refactor is complete
- WHEN inspecting the four route components
- THEN no inline or class-based main-content `maxWidth` overrides remain outside `SettingsShell` width variants

### Requirement: Optional Width Variants

`SettingsShell` MAY accept a width variant (e.g. `default`, `wide`, `full`) that adjusts the inner content `max-width` while preserving header and body structure.

#### Scenario: Wide variant for integrations content

- GIVEN `/settings` Integrations tab content uses `SettingsShell` with a `wide` variant
- WHEN the Integrations panel renders on a large viewport
- THEN content MAY expand beyond the default 1100px cap per design, without breaking shell header alignment

### Requirement: Tab Strip Compatibility

When `SettingsShell` receives a tab strip, it MUST render the existing accessible `TabList` unchanged — shell adoption MUST NOT alter tab count, labels, ARIA roles, or keyboard behavior defined by workspace settings IA.

#### Scenario: Settings tabs unchanged inside shell

- GIVEN a workspace member opens `/settings`
- WHEN the shell renders with its tab strip
- THEN exactly Members, Invites, and Integrations tabs appear with the same accessible tab semantics as before shell migration

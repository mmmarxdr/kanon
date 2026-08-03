# Delta for Workspace Settings IA

## ADDED Requirements

### Requirement: Settings Shell Integration

The `/settings` route MUST render its page chrome via `SettingsShell`, embedding the existing accessible `TabList` and tab panels as shell content. Shell adoption MUST NOT change tab labels, tab count, panel IDs, or keyboard navigation behavior.

#### Scenario: Settings page uses SettingsShell

- GIVEN any workspace member opens `/settings`
- WHEN the page renders
- THEN the page header, optional eyebrow, and tab strip live inside `SettingsShell`, and tab panels render in the shell body

#### Scenario: IA unchanged after shell migration

- GIVEN a workspace owner opens `/settings`
- WHEN they inspect tabs and the Invites domain-restriction disclosure
- THEN exactly three tabs exist (Members, Invites, Integrations), the Domains peer tab is absent, and owner-only domain restriction remains on Invites unchanged

## MODIFIED Requirements

### Requirement: Responsive Settings Body Width

All three tab panels MUST share a single responsive width rule enforced by `SettingsShell`'s inner content wrapper: `max-width: min(1100px, 100%)`. Per-tab or per-route fixed `maxWidth` overrides MUST NOT remain.
(Previously: panels shared one responsive width rule without naming `SettingsShell`; KAN-212 used approximately 880px.)

#### Scenario: Consistent width across tabs

- GIVEN a user switches between all three tabs
- WHEN each panel renders
- THEN all use the same `min(1100px, 100%)` width rule with no per-tab split such as `720`/`960`

#### Scenario: Wider than KAN-212 column

- GIVEN a viewport wider than 1100px
- WHEN any settings tab panel renders
- THEN content expands up to 1100px, utilizing more horizontal space than the prior ~880px cap

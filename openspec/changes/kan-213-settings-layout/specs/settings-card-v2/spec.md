# Settings Card v2 Specification

## Purpose

Extends `SettingsCard` with an optional structured header (title, description, actions) and an `insetList` mode so list-heavy sections visually separate scannable content from card chrome.

## Requirements

### Requirement: Structured Card Header

`SettingsCard` MUST accept optional `title`, `description`, and `actions` props (or equivalent slots) that render a consistent header row above card body content, replacing ad-hoc per-section `h2` + flex markup.

#### Scenario: Card renders title and actions

- GIVEN a section passes `title="Members"`, `description="Manage workspace access"`, and an actions slot with "Invite"
- WHEN the card renders
- THEN the header shows title left, description below or adjacent per design, and actions right-aligned in the same header region

#### Scenario: Header optional for simple cards

- GIVEN a `SettingsCard` is used without title/description/actions
- WHEN it renders
- THEN it behaves as a bordered content container equivalent to the pre-v2 baseline (no broken layout or missing padding)

### Requirement: Inset List Mode

When `insetList` is enabled, `SettingsCard` MUST remove horizontal padding from its list child region and MUST apply a subdued inset background (e.g. `bg-secondary/20`) so embedded `SettingsList` content reads as a distinct scannable block inside the card.

#### Scenario: Members card uses inset list

- GIVEN a Members `SettingsCard` wraps a `SettingsList` with `insetList` enabled
- WHEN the section renders
- THEN the list spans the card's inner width edge-to-edge within the inset background while the card header retains normal padding

#### Scenario: Non-list body unaffected

- GIVEN a `SettingsCard` with form fields and `insetList` false or unset
- WHEN the card renders
- THEN body padding matches standard card padding on all sides

### Requirement: Backward Compatibility

Existing `SettingsCard` usages without v2 props MUST continue to render valid layout and MUST NOT require migration in the same change unless they adopt header or inset list features.

#### Scenario: Legacy card unchanged

- GIVEN a section uses `SettingsCard` with only children and no v2 props
- WHEN rendered after the v2 enhancement ships
- THEN visual presentation remains a bordered card with standard padding — no regression from KAN-212 extraction baseline

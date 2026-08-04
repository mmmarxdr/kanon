# Workspace Settings IA Specification

## Purpose

Defines the 3-tab `/settings` structure (Members, Invites, Integrations), the owner-only invite-domain-restriction disclosure absorbed into Invites, accessible tab semantics, and token-backed coloring across workspace/project/admin settings surfaces in scope.

## Requirements

### Requirement: Settings Tab Structure

The system MUST render exactly three peer tabs on `/settings`: Members, Invites, Integrations. It MUST NOT render a Domains peer tab, for any role.

#### Scenario: Three tabs, no Domains

- GIVEN any workspace member opens `/settings`
- WHEN the tab strip renders
- THEN exactly Members, Invites, Integrations are shown and no Domains tab exists, even for a workspace owner

### Requirement: Accessible Tab Semantics

The tab strip MUST implement `role="tablist"`/`role="tab"`, `aria-selected`, `id`/`aria-controls` pairing each tab to its panel, and roving `tabindex` with arrow-key navigation that moves focus and activates the newly focused tab.

#### Scenario: Arrow-key navigation

- GIVEN focus is on the Members tab
- WHEN the user presses Right arrow
- THEN focus and selection move to Invites, `tabindex` flips (`0` on Invites, `-1` on Members), and the Invites panel becomes visible

#### Scenario: Tab exposes accessible state

- GIVEN the Integrations tab is active
- WHEN inspected by assistive tech
- THEN it has `aria-selected="true"`, an `id` referenced by its panel's `aria-labelledby`, and `aria-controls` matching the panel's `id`

### Requirement: Responsive Settings Body Width

All three tab panels MUST share a single responsive width rule instead of per-tab fixed `maxWidth` values.

#### Scenario: Consistent width across tabs

- GIVEN a user switches between all three tabs
- WHEN each panel renders
- THEN all use the same responsive width rule (no `720`/`960`-style per-tab split)

### Requirement: Owner-Only Invite-Domain Restriction Disclosure

Invites MUST expose a domain-restriction affordance (view/edit `Workspace.allowedDomains`) visible only to owners, SHOULD be a collapsed-by-default secondary disclosure, and MUST use copy distinct from `/admin/instance`'s signup-policy field. `isDomainAllowed()`/`DOMAIN_NOT_ALLOWED` enforcement MUST remain unchanged.

#### Scenario: Owner edits allowed domains from Invites

- GIVEN a workspace owner expands the disclosure on Invites
- WHEN they view it
- THEN they can edit allowed invite-acceptance domains with copy like "Restrict who can join via invite link", distinct from the admin signup-policy wording

#### Scenario: Non-owner cannot see the disclosure

- GIVEN a non-owner member opens Invites
- WHEN the tab renders
- THEN no domain-restriction control is visible

#### Scenario: Enforcement unchanged

- GIVEN a workspace has `allowedDomains` configured
- WHEN a user accepts an invite with an email outside those domains
- THEN the API rejects with `DOMAIN_NOT_ALLOWED` exactly as before this change

### Requirement: Token-Backed Colors on Settings Surfaces

Settings, project-settings, and admin surfaces in scope MUST NOT use hardcoded Tailwind green/emerald palette utilities for status indicators; they MUST use theme-token classes. Destructive confirm buttons on member-management surfaces MUST use token-backed foreground color, not hardcoded white text.

#### Scenario: Invite status badge is tokenized

- GIVEN an active invite is listed
- WHEN its status badge renders in dark mode
- THEN it uses a token-backed class, not `bg-green-500/10 text-green-700`

#### Scenario: Redmine success message and badge are tokenized

- GIVEN a Kanon project is bound to a Redmine project
- WHEN the success message and bound-project badge render
- THEN neither uses `text-emerald-600`/`bg-emerald-500/10`

#### Scenario: Admin Redmine maps-saved message is tokenized

- GIVEN a super-admin saves Redmine provider maps on `/admin/instance`
- WHEN the confirmation renders
- THEN it uses a token-backed class instead of `text-emerald-600`

#### Scenario: Destructive confirm buttons are tokenized

- GIVEN a user opens a remove-member confirmation (workspace or project Members)
- WHEN the destructive "Confirm" button renders
- THEN its text uses `text-destructive-foreground`, not hardcoded `text-white`

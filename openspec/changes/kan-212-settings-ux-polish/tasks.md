# Tasks: Settings UX Polish + IA Restructuring

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1150-1350 (A480/B70/C320/D260) |
| 400-line budget risk | High; A borderline alone |
| Chained PRs recommended | Yes |
| Delivery strategy | ask-on-risk → feature-branch-chain (user confirmed) |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | PR | Notes |
|------|------|-----|-------|
| A | Domains→Invites, Notifications→Profile | PR 1 | Largest; split A1/A2 if oversized |
| B | Token/contrast fixes (8 spots) | PR 2 | No new logic; re-run tests |
| C | Accessible `TabList` + width | PR 3 | Simpler after A (3 tabs) |
| D | `SettingsCard`, 5 sites | PR 4 | Mechanical; can trail chain |

## Phase 1: Slice A — IA Relocation

- [x] 1.1 RED `invite-domain-restriction.test.tsx`: owner add/remove calls mutation; non-owner sees nothing
- [x] 1.2 GREEN create `invite-domain-restriction.tsx` (`<details>` collapsed, owner-gated, `inviteDomainRestriction*` keys)
- [x] 1.3 Wire into `invites-section.tsx`; delete `domains-section.tsx`
- [x] 1.4 RED `profile.test.tsx`: renders section + "For workspace: {name}" when active; empty state if none; loading if pending
- [x] 1.5 GREEN `profile.tsx`: add `useActiveWorkspaceId()`/`useWorkspacesQuery()` (mirrors `settings.tsx`), render label + section/empty/loading
- [x] 1.6 `settings.tsx`: drop `"domains"`/`"notifications"` from `SettingsTab`/`TAB_KEYS`/render + imports
- [x] 1.7 `i18n/{en,es}/settings.json`: add `inviteDomainRestriction*` + `profileNotificationsFor`; drop `domains*`/`tabDomains`/`tabNotifications`
- [x] 1.8 RED extend `notification-preferences-section.test.tsx`: each toggle has `aria-label` matching its row label
- [x] 1.9 GREEN add matching `aria-label={t(labelKey)}` to the toggle button
- [x] 1.10 Run web settings+profile and api invite-service suites (`DOMAIN_NOT_ALLOWED` unchanged)

## Phase 2: Slice B — Token/Contrast Fixes

- [x] 2.1 `invites-section.tsx:43` green badge → `bg-success/10 text-success`
- [x] 2.2 `redmine-section.tsx:131,239` emerald → `text-success`/`bg-success/10 text-success`
- [x] 2.3 `admin-redmine-section.tsx:208` `text-emerald-600` → `text-success`
- [x] 2.4 `profile.tsx:188,284` green banners → `border-success/50 bg-success/10 text-success`
- [x] 2.5 `members-section.tsx:183`, `project-members-section.tsx:246` `text-white` → `text-destructive-foreground`
- [x] 2.6 `notification-preferences-section.tsx:92` knob `bg-white` → `bg-primary-foreground`
- [x] 2.7 Re-run affected suites; QA 8 spots × light/dark × 3 palettes

## Phase 3: Slice C — Accessible Tabs + Width

- [ ] 3.1 RED `primitives.test.tsx`: `TabList` sets `role="tablist"/"tab"`, `aria-selected`, `id`/`aria-controls`; Right-arrow flips `tabindex`+selection; Home/End jump first/last
- [ ] 3.2 GREEN add `TabList<T>` to `primitives.tsx`
- [ ] 3.3 `settings.tsx`: swap tab-strip for `TabList`; unify `maxWidth` to `"min(880px, 100%)"`
- [ ] 3.4 RED `settings.test.tsx`: exactly 3 tabs, no Domains for any role; panel `aria-labelledby`/`id` match
- [ ] 3.5 GREEN close gaps; run primitives + settings suites

## Phase 4: Slice D — SettingsCard Extraction

- [ ] 4.1 RED `settings-card.test.tsx`: renders children, merges `className`, `testId`→`data-testid`, base `p-5 sm:p-6`
- [ ] 4.2 GREEN create `settings-card.tsx` (`SettingsCard({ children, className?, testId? })`)
- [ ] 4.3 Migrate `members-section.tsx`, `invites-section.tsx`, `project-members-section.tsx` to `SettingsCard`
- [ ] 4.4 Migrate `redmine-section.tsx`, `admin-redmine-section.tsx`; drop local `Card`; keep `testId="admin-redmine-section"`
- [ ] 4.5 Re-run suites

## Cross-Slice Verification

- [ ] 5.1 Diff final state against every scenario in both spec files
- [ ] 5.2 Confirm `TODO(PR4)` and `admin.instance.tsx` shell untouched

# Tasks: Settings and Instance Admin Layout Density (KAN-213)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~450 (A), ~680 (B), ~400 (C); ~1500 total |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 Shell → PR2a members+invites → PR2b project+notifications → PR3 Admin |
| Delivery strategy | ask-on-risk |
| Chain strategy | feature-branch-chain on `feat/kan-213-settings-layout` (user confirmed) |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | SettingsShell + four route migrations | PR1 | Base: tracker branch |
| 2a | Workspace members + invites lists | PR2a | Sub-split B; base: PR1 branch |
| 2b | Project members + notification toggles | PR2b | Sub-split B; base: PR2a branch |
| 3 | SettingsCard v2 + SettingsField + admin grid | PR3 | Base: PR2b branch |

## Phase A: Shell (Slice A)

- [x] A.1 RED: `settings-shell.test.tsx` — default/wide max-width, tabPanel attrs, narrow viewport (spec: settings-shell)
- [x] A.2 GREEN: Create `components/ui/settings-shell.tsx` per design contract
- [x] A.3 Migrate `routes/_authenticated/settings.tsx` — SettingsShell, `maxWidth="wide"` on Integrations; preserve TabList + panel ids
- [x] A.4 Migrate `project-settings.tsx` — SettingsShell; remove 720px cap
- [x] A.5 Migrate `profile.tsx` — SettingsShell; remove `max-w-lg`
- [x] A.6 Migrate `admin.instance.tsx` — SettingsShell only; remove 560px wrapper (form grid deferred to C)
- [x] A.7 GREEN: Extend `settings.test.tsx` — 3 tabs, no Domains, `settings-panel-*` ids unchanged (delta: workspace-settings-ia)

## Phase B: Lists (Slice B)

- [x] B.1 RED: `settings-list.test.tsx` — column headers, 48px rows, grid alignment, mobile collapse (spec: settings-list-layout)
- [x] B.2 GREEN: Create `components/ui/settings-list.tsx` with column templates per design
- [x] B.3 Add i18n `listCol*` keys in `i18n/locales/{en,es}/settings.json`
- [x] B.4 RED→GREEN: `members-section.tsx` — SettingsCard title header + SettingsList/Row; preserve action testIds
- [x] B.5 RED→GREEN: `invites-section.tsx` — InviteRow → SettingsListRow; preserve invite testIds
- [x] B.6 RED→GREEN: `project-members-section.tsx` — SettingsList only; **TODO(PR4) logic untouched**
- [x] B.7 RED→GREEN: `notification-preferences-section.tsx` — SettingsListRow; preserve `toggle-${key}` + workspace scoping (delta: profile-notification-preferences)

**Slice B sub-split (400-line High):** PR2a = B.3–B.5; PR2b = B.6–B.7.

## Phase C: Admin (Slice C)

- [ ] C.1 RED: Extend `settings-card.test.tsx` — title/description/actions header, `insetList`, legacy compat (spec: settings-card-v2)
- [ ] C.2 GREEN: `settings-card.tsx` v2 props; apply `insetList` to members/invites cards
- [ ] C.3 RED: `settings-field.test.tsx` — label, htmlFor, span full/half
- [ ] C.4 GREEN: Create `components/ui/settings-field.tsx`; Tailwind inputs match `profile.tsx`
- [ ] C.5 GREEN: `admin.instance.tsx` — invite → SettingsCard; md two-column grid via SettingsField; preserve all data-testids (spec: instance-admin-layout)
- [ ] C.6 Verify: existing `admin-instance*.test.tsx` green; AdminRedmineSection card language unchanged

## Verification

- [ ] V.1 Run `pnpm --filter @kanon/web test` on all touched files
- [ ] V.2 Manual QA: 4 surfaces × 3 palettes × 2 appearances; no horizontal scroll on mobile lists

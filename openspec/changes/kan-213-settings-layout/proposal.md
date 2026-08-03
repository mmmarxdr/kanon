# Proposal: Settings and Instance Admin Layout Density (KAN-213)

## Intent

KAN-212 fixed IA and invisible polish; users still see the same sparse cards in narrow columns. **Persona:** every workspace member, project admin, and super-admin opening Settings, Project Settings, Profile, or Instance Admin. **Win:** settings read as a redesigned admin console — wider fluid layout, scannable columnar lists, Instance Admin no longer a 560px legacy form.

## Scope

### In Scope
- **Slice A — Shell:** `SettingsShell` primitive; migrate `/settings`, `/project-settings`, `/profile`, `/admin/instance`; default `min(1100px, 100%)`; remove per-route maxWidth hacks
- **Slice B — Lists:** `SettingsList`/`SettingsListRow`; column headers + ~48px rows for members, invites, project members, notification toggles
- **Slice C — Admin form:** `SettingsField`; Instance Admin two-column grid; invite-admin → `SettingsCard`; `SettingsCard` v2 (header slot, `insetList`)

### Out of Scope
- IA changes (KAN-212 tab structure, domain disclosure, profile notifications location)
- Backend/API, new dependencies, `project-members-section` TODO(PR4) logic
- Redmine integrations side-by-side layout (optional polish if budget allows)

## Assumptions

- KAN-212 IA is locked; this change is layout-only.
- Redmine credential/bind cards stay vertically stacked unless Slice C is under budget.

## Capabilities

### New Capabilities
- `settings-shell`: Shared `SettingsShell` chrome, width variants, migration of all four settings-like routes
- `settings-list-layout`: `SettingsList`/`SettingsListRow` grid columns, responsive mobile collapse, i18n column headers
- `settings-card-v2`: Enhanced `SettingsCard` (title/description/actions header, `insetList` for scannable lists)
- `instance-admin-layout`: Two-column form grid, `SettingsField` primitive, unified card language end-to-end on `/admin/instance`

### Modified Capabilities
- `workspace-settings-ia`: Body width and shell chrome via `SettingsShell`; tab count, ARIA, and 3-tab IA unchanged
- `profile-notification-preferences`: Notification toggle rows adopt `SettingsListRow`; workspace scoping unchanged

## Approach

**Approach 2 (SettingsShell + SettingsList redesign).** Three chained PR slices (A → B → C). Reject width-only bumps — they do not meet acceptance. Package: `web` only.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/web/src/components/ui/primitives.tsx` | New | `SettingsShell`, `SettingsField`, `SettingsList`/`SettingsListRow` |
| `packages/web/src/components/ui/settings-card.tsx` | Modified | v2 header + inset list |
| `packages/web/src/routes/_authenticated/{settings,project-settings,profile,admin.instance}.tsx` | Modified | Adopt shell; admin two-column |
| `packages/web/src/features/settings/*-section.tsx` | Modified | List density + card headers |
| `packages/web/src/features/project-members/project-members-section.tsx` | Modified | Shared list primitive |
| `packages/web/src/i18n/locales/{en,es}/settings.json` | Modified | Column header keys |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Visual regression (4 surfaces × 3 palettes × 2 appearances) | Med | Manual QA checklist in design/tasks |
| 400-line PR budget exceeded | Med | Chained slices; sub-split Slice B if needed |
| Admin testIds break | Low | Preserve `data-testid`s through layout refactor |
| Responsive list columns degrade poorly | Med | Design specifies mobile collapse explicitly |

## Rollback Plan

Each slice is a separate revertible PR with no backend/migration risk. Revert merge commit per slice; prior layout returns immediately.

## Dependencies

- KAN-212 merged (IA + `TabList`/`SettingsCard` baseline)
- Slice B/C depend on Slice A shell landing first

## Success Criteria

- [ ] All four surfaces share coherent `SettingsShell` chrome; content fills viewport to ~1100px
- [ ] Members/invites/project members show column headers and aligned ~48px rows
- [ ] Instance Admin uses two-column form on unified `SettingsCard` chrome (no 560px cap)
- [ ] Profile notification toggles match list row pattern
- [ ] KAN-212 IA intact; dark/light verified by eye on all surfaces

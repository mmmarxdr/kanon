# Proposal: Settings UX Polish + IA Restructuring

## Intent

Workspace Settings, Project Settings, and Instance Admin each hand-roll their own page shell (4 divergent max-width values, 3 layout conventions), the tab strip has zero ARIA semantics, and 6 hardcoded Tailwind-palette colors bypass the theme token bridge (visible dark-mode contrast bugs). Separately, product has locked new information-architecture (IA) decisions that relocate two features out of the current 5-tab Settings row. This change fixes the "feels unfinished / wasted space / wrong in dark mode" polish complaints AND ships the mandated IA relocation, as one ordered set of chainable slices. Affected persona: every workspace member (dev/PM/Director) who opens Settings, Project Settings, Admin, or Profile.

## Scope

### In Scope
- **Slice A (IA relocation, functional)**: remove Domains tab from `/settings`; add an owner-only, distinctly-labeled domain-restriction disclosure inside Invites (decision 2, Option B); relocate `NotificationPreferencesSection` to `/profile`, scoped via `useActiveWorkspaceId()` with a workspace-context label (decision 3).
- **Slice B (token/contrast fixes)**: replace all 6 hardcoded `green-*`/`emerald-*` utilities (invites, redmine, admin-redmine, profile ×2) with token-backed classes; `text-white` → `text-destructive-foreground` on destructive confirm buttons.
- **Slice C (accessible tabs + responsive width)**: `role="tablist"/"tab"`, `aria-selected`, `id`/`aria-controls` pairing, roving tabindex + arrow-key nav for the (now 3-tab) Settings strip; replace the `720`/`960` split with one responsive width rule.
- **Slice D (optional, later in chain)**: extract a shared `SettingsCard` primitive; migrate duplicate card-shell call sites (members, invites, project-members, redmine, admin-redmine).

### Out of Scope
- Instance-wide signup/domain policy on `/admin/instance` (decision 1 — already correctly placed, polish-only, no IA change).
- Multi-workspace notification-preferences UI (only active-workspace is shown on `/profile`; flag as future follow-up).
- Migrating `admin.instance.tsx` or `profile.tsx` onto the new `SettingsCard`/shell primitive (Approach 3 explicitly leaves these structurally as-is).
- `project-members-section.tsx`'s `TODO(PR4)` role-assignability logic (line 15) — untouched.
- Any backend/API change — `isDomainAllowed()`/`DOMAIN_NOT_ALLOWED` enforcement and notification-preference persistence are UI-relocation-only.

## Capabilities

### New Capabilities
- `workspace-settings-ia`: the workspace Settings tab structure (Members/Invites/Integrations, 3 tabs) including the owner-only invite-domain-restriction disclosure and accessible tab semantics (ARIA roles, keyboard nav).
- `profile-notification-preferences`: workspace-scoped notification preferences rendered on `/profile`, resolved via active-workspace context, with a contextual workspace label.

### Modified Capabilities
None — no prior spec exists for these UI surfaces.

## Approach

Hybrid (exploration Approach 3): ship the product-mandated IA relocation (Slice A) first and independently, since it's functional and highest-risk; follow with isolated, low-risk token fixes (Slice B); then accessible-tabs + responsive width (Slice C), now simpler with 3 tabs instead of 5; `SettingsCard` extraction (Slice D) is mechanical and can trail the chain or ship later. `admin.instance.tsx` and `profile.tsx` receive only their Slice A/B touches — no shell migration.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/web/src/routes/_authenticated/settings.tsx` | Modified | Drop Domains tab; accessible tab strip; unified width |
| `packages/web/src/features/settings/invites-section.tsx` | Modified | Absorbs owner-only domain-restriction disclosure; fix hardcoded badge color |
| `packages/web/src/features/settings/domains-section.tsx` | Modified/Removed | Logic relocated into invites-section (extraction detail left to sdd-design) |
| `packages/web/src/routes/_authenticated/profile.tsx` | Modified | Gains `NotificationPreferencesSection` + `useActiveWorkspaceId()` wiring; fix 2 hardcoded colors |
| `packages/web/src/features/settings/notification-preferences-section.tsx` | Modified | Import site moves; add toggle `aria-label`; fix `bg-white` knob |
| `packages/web/src/features/settings/redmine-section.tsx` | Modified | Fix `text-emerald-600` (×2); ownership unchanged (see assumption below) |
| `packages/web/src/features/settings/admin-redmine-section.tsx` | Modified | Fix `text-emerald-600`; ownership unchanged (instance admin) |
| `packages/web/src/features/settings/members-section.tsx` | Modified | `text-white` → `text-destructive-foreground` |
| `packages/web/src/features/project-members/project-members-section.tsx` | Modified | `text-white` fix only; TODO(PR4) logic untouched |
| `packages/web/src/components/ui/primitives.tsx` | New (Slice C/D) | Accessible `Tabs` pattern; optional `SettingsCard` |
| `packages/api/src/modules/invite/service.ts` | Read-only reference | Verify `DOMAIN_NOT_ALLOWED` behavior unchanged |

Packages touched: `web` only (UI relocation + presentation). No `api`/`mcp`/`cli`/`shared` changes.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Slice A regresses `DOMAIN_NOT_ALLOWED` invite enforcement or notification read/write semantics | Med | Explicit manual smoke + existing test coverage re-run before merging Slice A; no backend change |
| `/profile` has no workspace-context today; undefined `useActiveWorkspaceId()` case | Low | Define explicit empty/disabled state for zero-workspace users in design phase |
| Visual regression across 3 palettes × 2 appearances × 4 surfaces | Med | Manual QA checklist per palette/appearance before each slice merges; no automated visual regression tooling exists |
| Slice A / Slice D exceed 400-line PR budget | Med | `delivery_strategy: ask-on-risk` — sdd-tasks forecasts per-slice line counts; chain PRs per `chained-pr` skill if needed |
| Ambiguous ownership of workspace `redmine-section.tsx` | Low | Resolved as an assumption below, not silently carried to apply |

## Rollback Plan

Each slice ships as its own chained PR with no Prisma/backend change, so rollback is a plain `git revert` of the slice's merge commit with zero data-migration risk. Slice A revert restores the 5-tab layout and settings-page notification section exactly as they exist today (no data loss — `allowedDomains` and notification preferences are unchanged server-side, only their UI location moves).

## Dependencies

- Slice C (accessible tabs) is easiest once Slice A lands (3 tabs vs. 5), but is not hard-blocked by it.
- Slice B and Slice D have no ordering dependency on A or each other.

## Success Criteria

- [ ] Domains tab no longer appears as a peer tab on `/settings`; domain-restriction is editable only via the owner-only disclosure inside Invites, with distinct copy from `/admin/instance`'s signup-policy field.
- [ ] `DOMAIN_NOT_ALLOWED` invite-acceptance enforcement verified unchanged end-to-end.
- [ ] Notification preferences render on `/profile`, scoped to the active workspace, with a visible workspace-context label; per-workspace read/write API unchanged.
- [ ] All 6 identified hardcoded palette colors (+ `text-white` on destructive buttons) replaced with token-backed classes; verified in light/dark × cobalt/teal/mono.
- [ ] Settings tab strip has `role="tablist"/"tab"`, `aria-selected`, `id`/`aria-controls`, and arrow-key roving-tabindex navigation.
- [ ] No regression to Project Settings, Instance Admin, or Redmine bootstrap/coverage flows.

## Proposal question round

Product decisions 1-4 are locked and are NOT reopened here. One exploration-flagged ambiguity remains and is resolved below as a stated assumption rather than a blocking question — flag for user override if incorrect:

- **Workspace `redmine-section.tsx` (Integrations tab: personal credential connect/disconnect, Kanon↔Redmine project bind, workspace-admin coverage dashboard) stays on workspace Settings under "Integrations."** It is neither "bootstrap/maps" (instance-admin-only service config, decision 4) nor "members/invites" — it's a third, distinct per-user/per-workspace Redmine surface. Default assumption: **unaffected by this change's IA scope**, receives only its Slice B color fix. No action needed unless this assumption is wrong.

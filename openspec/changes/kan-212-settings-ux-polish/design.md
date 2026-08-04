# Design: Settings UX Polish + IA Restructuring

## Technical Approach

Four independently-mergeable slices. A relocates two features (Domains → Invites, Notifications → Profile), zero backend change. B swaps 8 hardcoded color/text utilities for tokens already in `index.css`'s `@theme` bridge. C adds an accessible `TabList` primitive + one responsive width rule to `settings.tsx` only. D extracts `SettingsCard`, migrates 5 duplicate card-shell sites. Order: A → B → C → D.

## Architecture Decisions

### 1. Domains relocation into Invites
**Choice**: Delete `domains-section.tsx`. New `invite-domain-restriction.tsx` exports `InviteDomainRestriction`, rendered inside `InvitesSection` as a native `<details>/<summary>` disclosure (collapsed by default), gated to `currentUserRole === "owner"` — narrowed from `admin || owner`, per decision 2's "owner-only" wording. Reuses `useUpdateWorkspaceMutation` unchanged. New copy keys `inviteDomainRestriction*` (e.g. "Restrict who can join via invite link"), distinct from `admin.instance.tsx`'s "Allowed signup domains".
**Rejected**: Nesting `DomainsSection` unmodified — reads as a peer card, risks copy confusion.

### 2. Profile notification wiring
**Choice**: `profile.tsx` calls `useActiveWorkspaceId()` + `useWorkspacesQuery()` (mirrors `settings.tsx:33-38`). Renders "For workspace: {name}" + `<NotificationPreferencesSection workspaceId={id}/>` when defined; else an empty-state card. Section component untouched.
**Rejected**: Passing `workspaceName` into the section — keeps its API stable; label is page-level.

### 3. Accessible tabs primitive
**Choice**: Add `TabList` to `primitives.tsx`, alongside `Segmented`/`FilterChipSelect`. `role="tablist"`; tabs get `role="tab"`, `aria-selected`, `id`, roving `tabIndex` (active = `0`), `aria-controls`; arrow keys/Home/End navigate + activate.
**Rejected**: Local to `settings.tsx` — breaks the file's convention of centralizing UI atoms.

### 4. Responsive width (`settings.tsx` only)
**Choice**: Replace `maxWidth: activeTab === "integrations" ? 960 : 720` with `maxWidth: "min(880px, 100%)"`. 880 splits the old values; `100%` shrinks on narrow viewports. Other shells untouched per Approach 3.
**Rejected**: `clamp()` with `vw` — no shell in the codebase uses viewport units.

### 5. Token replacements
| File:Line | Old | New |
|---|---|---|
| `invites-section.tsx:43` | `bg-green-500/10 text-green-700` | `bg-success/10 text-success` |
| `redmine-section.tsx:131` | `text-emerald-600` | `text-success` |
| `redmine-section.tsx:239` | `bg-emerald-500/10 text-emerald-600` | `bg-success/10 text-success` |
| `admin-redmine-section.tsx:208` | `text-emerald-600` | `text-success` |
| `profile.tsx:188`, `:284` | `border-green-500/50 bg-green-500/10 text-green-700` | `border-success/50 bg-success/10 text-success` |
| `members-section.tsx:183` | `text-white` | `text-destructive-foreground` |
| `project-members-section.tsx:246` | `text-white` | `text-destructive-foreground` |
| `notification-preferences-section.tsx:92` (knob) | `bg-white` | `bg-primary-foreground` |

Tokens already exist in the `@theme` bridge — no CSS changes. Knob uses `bg-primary-foreground` (→ `--btn-ink`), already used elsewhere for content on `bg-primary`/`bg-destructive` — the knob's exact case.

### 6. SettingsCard extraction (Slice D)
**Choice**: New file `components/ui/settings-card.tsx` (own file, like `filter-bar.tsx`, not folded into `primitives.tsx`). `SettingsCard({ children, className?, testId? })` renders the shell, standardizing on redmine's `p-5 sm:p-6` over members/invites' plain `p-6`. Migrates all 5 card-shell sites; `redmine-section.tsx`/`admin-redmine-section.tsx` drop their local `Card` helpers (admin keeps `data-testid="admin-redmine-section"` via `testId`).
**Rejected**: A `clsx`/`cn` helper — not a dependency in `web/package.json`; plain string join suffices.

### 9. Redmine ownership
Confirmed unchanged: workspace `redmine-section.tsx` stays on "Integrations", Slice B color fix only. (Decisions 7-8: file table / test plan below.)

## Data Flow (Slice A)

    InvitesSection → InviteDomainRestriction (owner-only)
      → useUpdateWorkspaceMutation → PATCH /api/workspaces/:id → isDomainAllowed() unchanged

    ProfilePage → useActiveWorkspaceId()
      → defined:   NotificationPreferencesSection(workspaceId) → unchanged API
      → undefined: empty-state card

## File Changes

| File | Action | Description |
|---|---|---|
| `features/settings/domains-section.tsx` | Delete | Moved to `invite-domain-restriction.tsx` |
| `features/settings/invite-domain-restriction.tsx` | Create | Owner-only disclosure |
| `features/settings/invites-section.tsx` | Modify | Disclosure + badge color + `SettingsCard` |
| `routes/_authenticated/settings.tsx` | Modify | Drop 2 tabs; `TabList`; single `maxWidth` |
| `routes/_authenticated/profile.tsx` | Modify | Workspace wiring + notification section; 2 colors |
| `features/settings/notification-preferences-section.tsx` | Modify | Toggle `aria-label`; knob color |
| `features/settings/redmine-section.tsx` | Modify | 2 colors; `SettingsCard` |
| `features/settings/admin-redmine-section.tsx` | Modify | 1 color; `SettingsCard` |
| `features/settings/members-section.tsx` | Modify | `text-white` fix; `SettingsCard` |
| `features/project-members/project-members-section.tsx` | Modify | `text-white` fix; `SettingsCard`; `TODO(PR4)` untouched |
| `components/ui/primitives.tsx` | Modify | Add `TabList` |
| `components/ui/settings-card.tsx` | Create | Shell component |
| `i18n/locales/{en,es}/settings.json` | Modify | New `inviteDomainRestriction*` keys; drop unused ones |

## Interfaces

```ts
interface TabDef<T extends string> { key: T; label: string; }
function TabList<T extends string>(props: {
  tabs: TabDef<T>[]; activeKey: T; onChange: (key: T) => void; idPrefix: string;
}): JSX.Element;
function SettingsCard(props: { children: ReactNode; className?: string; testId?: string }): JSX.Element;
```

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit | Toggle `aria-label` | Extend `notification-preferences-section.test.tsx` |
| Unit | `InviteDomainRestriction` | New file — add/remove/owner-gating (no prior test) |
| Unit | `TabList` | New file — roving tabindex, `aria-selected` |
| Unit | `SettingsCard` migration | Existing tests have no class-string assertions — re-run only |
| Manual | Visual regression | 3 themes × 2 appearances — no tooling in repo |
| Integration | `DOMAIN_NOT_ALLOWED` | Re-run existing `packages/api` invite-service tests |

## Migration / Rollout
None — no Prisma/backend change. Each slice ships/reverts independently per the proposal's rollback plan.

## Open Questions
None — all 4 product decisions are locked; the flagged ambiguity is resolved in Decision 9.

# Design: Settings and Instance Admin Layout Density (KAN-213)

## Technical Approach

Introduce four layout primitives in `packages/web`, migrate all four settings-like routes onto `SettingsShell` (Slice A), restructure list sections with `SettingsList`/`SettingsListRow` (Slice B), then unify Instance Admin forms via `SettingsField` + `SettingsCard` v2 (Slice C). Layout-only — KAN-212 IA, tab ids, and behavioral testIds stay stable. No API or dependency changes.

## Architecture Decisions

| Decision | Alternatives | Choice | Rationale |
|----------|--------------|--------|-----------|
| Shell file location | All in `primitives.tsx` (~789 LOC) | Dedicated `settings-shell.tsx` | Page chrome is route-level; mirrors `settings-card.tsx` split; keeps `TabList` in primitives |
| List primitives location | Inline per section | `settings-list.tsx` | Shared grid contract across 4 consumers; testable in isolation |
| Width default | Keep 880px | `min(1100px, 100%)` | Matches exploration viewport analysis; visible redesign signal |
| Wide variant | Single width everywhere | `wide` = `min(1200px, 100%)` on Integrations tab only | Redmine multi-card stack benefits; other surfaces use default |
| Shell styling | Tailwind page wrapper | Raw `var(--*)` header/body (copy `settings.tsx` L53–111) | Consistent with authenticated page chrome; inner sections stay Tailwind |
| Admin fields | Keep inline var wrappers | `SettingsField` + profile-matching Tailwind inputs | Eliminates dual visual system on `/admin/instance` |
| Card v2 timing | Slice A | Slice C (header/inset) | Slice A uses existing `SettingsCard`; v2 ships with admin unification |
| Redmine side-by-side | lg+ two-column credentials | Defer (vertical stack) | Optional polish; out of budget per proposal |

## Data Flow

```
Route (settings | project-settings | profile | admin.instance)
  └─ SettingsShell (title, eyebrow, tabs?, maxWidth)
       └─ tabpanel wrapper (role/id/aria from route — unchanged ids)
            └─ SettingsCard [v2 in Slice C] (title?, insetList?)
                 └─ SettingsList → SettingsListRow × N
                 └─ SettingsField grid (admin Slice C)
```

No store/API changes. Sections keep existing React Query hooks.

## Interfaces / Contracts

### SettingsShell (`settings-shell.tsx`)

```tsx
type SettingsShellMaxWidth = "default" | "wide";

interface SettingsShellProps {
  title: string;
  eyebrow?: string;
  /** When set, renders TabList in header; route owns activeKey state */
  tabs?: {
    idPrefix: string;
    tabs: TabDef<string>[];
    activeKey: string;
    onChange: (key: string) => void;
  };
  maxWidth?: SettingsShellMaxWidth; // default → min(1100px,100%); wide → min(1200px,100%)
  /** Required when tabs set — preserves KAN-212 a11y pairing */
  tabPanel?: { id: string; ariaLabelledBy: string };
  children: ReactNode;
}
```

Header: `padding: 20px 28px 0`, `borderBottom: var(--line)`. Body: `flex:1; overflow:auto; padding: 20px 28px 28px`. Inner column: `display:flex; flexDirection:column; gap:24`.

### SettingsList / SettingsListRow (`settings-list.tsx`)

```tsx
interface SettingsListProps {
  columns: { key: string; label: string; className?: string; hideBelow?: "sm" | "md" }[];
  children: ReactNode;
  "data-testid"?: string;
}

interface SettingsListRowProps {
  columns: ReactNode[]; // length MUST match SettingsList.columns
  className?: string;
}
```

**Column templates** (CSS grid on `SettingsList`, `min-h-[48px]` rows, header `text-xs uppercase text-muted-foreground`):

| Surface | Grid (sm+) | Mobile collapse |
|---------|------------|-----------------|
| Workspace members | `2fr 1.5fr 1fr auto auto` — member, email, joined, role, actions | Hide joined; email under name in col 1 |
| Invites | `1.5fr auto auto 1.5fr auto auto auto auto` — label, status, role, email, uses, expires, by, actions | Stack meta under label; hide expires/by |
| Project members | `2fr 1.5fr auto auto` — member, email, role, actions | Same as workspace members |
| Notifications | `auto 1fr` — toggle, label+description | No header row |

i18n keys in `settings.json`: `listColMember`, `listColEmail`, `listColJoined`, `listColRole`, `listColActions`, `listColStatus`, `listColUses`, `listColExpires`, `listColCreatedBy`.

### SettingsCard v2 (`settings-card.tsx`)

```tsx
interface SettingsCardProps {
  children: ReactNode;
  className?: string;
  testId?: string;
  title?: string;
  description?: string;
  actions?: ReactNode;
  insetList?: boolean; // strips horizontal card padding; list area bg-secondary/20
}
```

Backward compatible: bare `children` unchanged (existing tests pass). Header renders `flex justify-between` when `title` set.

### SettingsField (`settings-field.tsx`)

```tsx
interface SettingsFieldProps {
  label: string;
  htmlFor: string;
  hint?: string;
  span?: "full" | "half"; // full → md:col-span-2
  children: ReactNode;
}
```

Input classes match `profile.tsx` L173 (`rounded-md border border-input bg-background px-3 py-2 text-sm …`).

### Instance Admin grid (Slice C)

Wrap body in `SettingsShell` (`title`: i18n `instance.title`, `eyebrow`: `super-admin`). Stack:

1. `SettingsCard testId="invite-admin-section"` — invite form (preserve all invite-admin-* testIds)
2. `SettingsCard testId="admin-instance-form"` — `md:grid md:grid-cols-2 md:gap-x-6 md:gap-y-4`:
   - `instanceName` → span full
   - `signupMode` \| `allowedDomains`
   - `redmineBaseUrl` \| `defaultLocale`
3. `AdminRedmineSection` — unchanged

Remove `maxWidth: 560` wrapper. Preserve input `id` + `data-testid` on every field.

## File Changes

| File | Slice | Action |
|------|-------|--------|
| `components/ui/settings-shell.tsx` | A | Create |
| `components/ui/settings-list.tsx` | B | Create |
| `components/ui/settings-field.tsx` | C | Create |
| `components/ui/settings-shell.test.tsx` | A | Create |
| `components/ui/settings-list.test.tsx` | B | Create |
| `components/ui/settings-field.test.tsx` | C | Create |
| `components/ui/settings-card.tsx` | C | Modify — v2 props |
| `components/ui/settings-card.test.tsx` | C | Extend |
| `routes/_authenticated/settings.tsx` | A | Migrate to SettingsShell; `maxWidth="wide"` on integrations tab |
| `routes/_authenticated/project-settings.tsx` | A | Migrate; remove 720px cap |
| `routes/_authenticated/profile.tsx` | A | Migrate; remove `max-w-lg` |
| `routes/_authenticated/admin.instance.tsx` | A+C | Shell (A); grid + SettingsField + cards (C) |
| `features/settings/members-section.tsx` | B | SettingsCard header + SettingsList |
| `features/settings/invites-section.tsx` | B | InviteRow → SettingsListRow |
| `features/settings/notification-preferences-section.tsx` | B | SettingsCard + list rows |
| `features/project-members/project-members-section.tsx` | B | SettingsList only — **TODO(PR4) logic untouched** |
| `i18n/locales/{en,es}/settings.json` | B | Column header keys |
| `routes/_authenticated/settings.test.tsx` | A | Assert tabpanel ids unchanged inside shell |

## Migration Order

**A → B → C** (each slice = one PR, revertible).

- **A**: Shell + route migration + shell unit tests. User sees wider coherent headers; admin loses 560px cap.
- **B**: List primitives + section migration + i18n + list tests. Biggest visual density win.
- **C**: SettingsCard v2 + SettingsField + admin form grid + card tests. Admin visual parity.

Slice B may sub-split (members+invites vs project+notifications) if 400-line forecast is High.

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit | SettingsShell width variants, tabPanel attrs | RTL — `settings-shell.test.tsx` |
| Unit | SettingsList column count, header visibility, row min-height | RTL — `settings-list.test.tsx` |
| Unit | SettingsCard v2 header/inset backward compat | Extend `settings-card.test.tsx` |
| Unit | SettingsField label/htmlFor | RTL — `settings-field.test.tsx` |
| Integration | KAN-212 tab IA | Existing `settings.test.tsx` — 3 tabs, no Domains, `settings-panel-*` ids |
| Integration | Admin form + invite | Existing `admin-instance*.test.tsx` — all `data-testid`s preserved |
| Integration | Notification toggles | `toggle-${key}` testIds unchanged |
| Integration | Onboarding buttons | `onboarding-gen-btn-${member.id}` unchanged |
| Manual | 4 surfaces × 3 palettes × 2 appearances | QA checklist in tasks |

## Migration / Rollout

No backend migration. Feature-flag not required — layout is forward-only. Rollback = revert slice PR.

## Open Questions

- [ ] None blocking — Redmine side-by-side deferred to follow-up if Slice C under budget.

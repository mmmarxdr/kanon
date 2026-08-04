## Exploration: Settings and Instance Admin layout density (KAN-213)

### Current State

KAN-212 shipped the IA cleanup (3 tabs on `/settings`, Domains → Invites disclosure, Notifications → Profile) plus engineering polish: `TabList` a11y, `SettingsCard` extraction, token fixes, and a unified `maxWidth: min(880px, 100%)` on workspace settings. **User feedback: screens look the same.** The gap is visual/layout, not IA or invisible refactors.

**Why 880px did not feel like a redesign**

The content column widened slightly, but section internals did not change shape:

- `SettingsCard` is a thin wrapper (`rounded-lg border border-border bg-card p-5 sm:p-6`) — identical visual to pre-extraction Tailwind cards.
- Member and invite rows remain single flex rows (`py-2 px-3`, ~36–40px tall) with name/email/role/actions crammed horizontally; widening the container does not use horizontal space because there are no columns, headers, or split layouts.
- Integrations (Redmine) stacks multiple cards vertically — same sparse card-on-card pattern.
- No shared page shell exists; each route hand-rolls chrome.

**Four divergent settings-like surfaces (post-KAN-212)**

| Surface | Route | Shell | Content max-width | Styling system |
|---------|-------|-------|-------------------|----------------|
| Workspace settings | `/settings` | Header + `TabList` + scroll body | `min(880px, 100%)` | Raw `var(--*)` page chrome; Tailwind `SettingsCard` sections |
| Project settings | `/project-settings/$key` | Flat title + scroll | `720px` fixed | Raw `var(--*)` chrome; `SettingsCard` section |
| Instance admin | `/admin/instance` | Header only (no tabs) | **`560px` fixed** | Raw `var(--*)` inline form chrome throughout; `AdminRedmineSection` uses `SettingsCard` at bottom — **two visual systems on one page** |
| Profile | `/profile` | Flat title + stacked cards | `max-w-lg` (~512px) | Tailwind cards; notification block uses same sparse card pattern as settings |

**Viewport context:** Authenticated layout is sidebar + topbar; main content area is `flex: 1` with no max-width cap. On a typical 1440px display, settings content occupies ~880px of ~1100px+ available — visible dead space on the right. Instance admin uses only 560px — roughly half the available width.

**Member/invite row structure today**

- `members-section.tsx`: avatar (32px) + name/email stack + joined date (hidden on small) + role select/badge + onboard btn + remove btn — all in one `flex items-center` row.
- `invites-section.tsx` `InviteRow`: label + status badge + role + email inline on line 1; uses/expiry/creator on line 2 — still a compact card row, not a scannable list.
- `project-members-section.tsx`: near-duplicate of members row pattern.
- `notification-preferences-section.tsx` (on `/profile`): toggle rows use the same `py-2 px-3 hover:bg-secondary/50` pattern — inherits sparse list feel.

**Instance Admin specifics**

- `admin.instance.tsx` lines 272–677: entire body constrained to `maxWidth: 560`.
- Form fields use bespoke inline wrappers (`height: 36`, `border: 1px solid var(--line-2)`, `background: var(--panel)`) — different border radius, label size (11px), and button styling from Tailwind form controls used elsewhere.
- Invite-admin block uses `var(--bg-2)` inset panel — visually distinct from `SettingsCard`.
- `AdminRedmineSection` below the form uses `SettingsCard` — abrupt style transition mid-scroll.

**KAN-212 IA is locked (must not regress)**

- `/settings` tabs: Members, Invites, Integrations only.
- Domain restriction stays in Invites as owner-only disclosure (`invite-domain-restriction.tsx`).
- Notification preferences stay on `/profile` with workspace scoping.

### Affected Areas

- `packages/web/src/routes/_authenticated/settings.tsx` — page shell; tab panel width; candidate for `SettingsShell` migration
- `packages/web/src/routes/_authenticated/project-settings.tsx` — orphan shell at 720px; should adopt shared shell + width
- `packages/web/src/routes/_authenticated/admin.instance.tsx` — **primary pain point**: 560px cap, raw-var form chrome, no `SettingsShell`; needs two-column layout and card unification
- `packages/web/src/routes/_authenticated/profile.tsx` — narrow `max-w-lg`; notification block inherits sparse card/list pattern
- `packages/web/src/components/ui/settings-card.tsx` — needs enhancement beyond border wrapper (header slot, inset list area) for visible density change
- `packages/web/src/components/ui/primitives.tsx` — home for new `SettingsShell`, `SettingsField`, `SettingsList`/`SettingsListRow` primitives (matches `TabList` placement)
- `packages/web/src/features/settings/members-section.tsx` — row layout → structured list with column headers
- `packages/web/src/features/settings/invites-section.tsx` — `InviteRow` layout; create form could use two-column grid at md+
- `packages/web/src/features/settings/notification-preferences-section.tsx` — migrate to `SettingsCard` + list row primitive; used on profile
- `packages/web/src/features/settings/redmine-section.tsx` — multi-card stack; may benefit from side-by-side layout for credential + bind at lg+
- `packages/web/src/features/settings/admin-redmine-section.tsx` — already on `SettingsCard`; stays after admin shell migration
- `packages/web/src/features/settings/invite-domain-restriction.tsx` — disclosure pattern OK; align spacing with new shell
- `packages/web/src/features/project-members/project-members-section.tsx` — share member list primitive; **`TODO(PR4)` logic untouched**
- `packages/web/src/i18n/locales/{en,es}/settings.json` — possible new keys for list column headers
- `packages/web/src/routes/_authenticated/settings.test.tsx` — TabList tests; update if shell wraps DOM
- `packages/web/src/routes/__tests__/admin-instance*.test.tsx` — form testIds must survive layout refactor

**Reference patterns in codebase**

- `cycles.tsx` picker: header strip + `maxWidth: 880` grid — good shell precedent but still not wide enough for settings density goal
- `admin-redmine-section.tsx`: already uses `sm:grid-cols-2` for status maps — proves two-column forms work in settings context
- `metadata-section.tsx`: `grid grid-cols-2 gap-x-4` — compact field pairing precedent

### Approaches

1. **Width-only bump (reject as main win)** — Raise caps (`880→1100`, `560→880`, `720→880`, `max-w-lg→max-w-3xl`) without restructuring sections.
   - Pros: Smallest diff (~20 lines), low regression risk.
   - Cons: **User-visible impact negligible** — same card shapes, same row density, Instance Admin still feels like a different product. Does not meet acceptance criteria.
   - Effort: Low

2. **SettingsShell + SettingsList redesign (recommended)** — Introduce shared layout primitives and migrate all four surfaces; restructure list sections into scannable columnar layouts; two-column Instance Admin form.
   - Pros: **Immediately noticeable** — wider fluid column, consistent header chrome, table-like member/invite lists, admin form uses full width with field pairing, Instance Admin matches workspace settings visually. Builds on KAN-212 primitives instead of re-extracting cards.
   - Cons: Medium-large diff (~600–900 lines across 12+ files); needs 2–3 chained PRs for 400-line budget; visual QA across 3 themes × 2 appearances × 4 surfaces.
   - Effort: Medium–High

3. **Admin-only redesign, leave workspace settings rows as-is** — Full `SettingsShell` + two-column layout for `/admin/instance` only; bump widths elsewhere.
   - Pros: Fixes the worst offender (560px); smaller than full migration.
   - Cons: Workspace settings — the surface users visit most — still looks unchanged; fails "share a visually coherent settings shell" acceptance criterion.
   - Effort: Medium

### Recommendation

**Approach 2 (SettingsShell + SettingsList redesign)**, phased as three chained PR slices. Reject "extract same card again" or width-only tweaks as the primary deliverable.

#### Proposed primitives

**`SettingsShell`** (`components/ui/settings-shell.tsx` or `primitives.tsx`)

```tsx
// Conceptual API — design phase finalizes
SettingsShell({
  title, eyebrow?, tabs?: TabList props, maxWidth?: "default" | "wide" | "full",
  children
})
```

- **Header**: matches `/settings` today (title + mono eyebrow + optional `TabList`) — becomes the single chrome implementation.
- **Body**: `padding: 20px 28px 28px`, scrollable; inner content wrapper `maxWidth: min(1100px, 100%)` (default) — wider than KAN-212's 880px, aligned with cycles/issue-doc density tier.
- **Variants**: `wide` for integrations tab content (`min(1200px, 100%)` optional); Instance Admin uses default.
- Written in raw `var(--*)` style to match page chrome convention; sections inside remain Tailwind/`SettingsCard`.

**`SettingsCard` v2** — extend existing component:

- Optional `title`, `description`, `actions` header row (eliminates repeated `h2` + flex patterns).
- Optional `insetList` prop: removes horizontal padding on list child, adds `bg-secondary/20` inset — visually separates scannable lists from card chrome.

**`SettingsList` + `SettingsListRow`** — shared member/invite/notification row layout:

- Desktop (`sm+`): CSS grid columns — e.g. Members: `[avatar+name] [email] [joined] [role] [actions]` with header row (`text-xs uppercase text-muted-foreground`).
- Row height ~48–52px (not cramped 36px); primary text `text-sm font-medium`, secondary `text-xs text-muted-foreground` on dedicated lines.
- Actions column: right-aligned, consistent button sizing (`text-xs`, min-width for align).
- Mobile: stack gracefully (hide non-essential columns, keep actions accessible).

**Instance Admin layout**

- Migrate onto `SettingsShell` (title: "Instance Settings", eyebrow: "super-admin").
- Replace raw-var field wrappers with shared **`SettingsField`** (label + Tailwind input/select matching profile/settings forms) OR Tailwind classes consistent with `profile.tsx` inputs.
- **Two-column grid** (`md:grid-cols-2 gap-x-6 gap-y-4`) for:
  - Row 1: Instance name (full width)
  - Row 2: Signup mode | Allowed signup domains
  - Row 3: Redmine base URL | Default email locale
- Invite-admin block → `SettingsCard` with title/description (not `var(--bg-2)` bespoke panel).
- Main save form + `AdminRedmineSection` as separate `SettingsCard`s in vertical stack — unified card language end-to-end.
- Remove `maxWidth: 560` — inherit shell width.

**Profile**

- Adopt `SettingsShell` (no tabs) or at minimum widen to shell default width.
- Wrap profile/password/notification blocks in enhanced `SettingsCard`.
- Notification toggles use `SettingsListRow` pattern for consistency with members.

**Project settings**

- Adopt `SettingsShell`; reuse `SettingsList` for project members.

#### Phased delivery (400-line budget)

| Slice | Scope | Est. lines | User-visible win |
|-------|-------|------------|------------------|
| **A — Shell + width** | `SettingsShell`; migrate `settings.tsx`, `project-settings.tsx`, `profile.tsx`, `admin.instance.tsx` onto it; remove per-route maxWidth hacks | ~250–350 | Consistent headers, wider column, admin no longer skinny |
| **B — List density** | `SettingsList`/`SettingsListRow`; migrate members, invites, project-members, notification prefs | ~300–400 | Table-like scannable lists — biggest "feels redesigned" signal |
| **C — Admin form + cards** | `SettingsField`; admin two-column grid; invite-admin → SettingsCard; `SettingsCard` v2 header/inset | ~250–350 | Admin matches product; form uses horizontal space |

Slice A should merge first so B/C build on stable shell. **400-line budget risk: Medium** — Slice B may need split (members+invites vs project+notifications).

#### What users will notice after deploy

1. Settings pages breathe — content fills the viewport up to ~1100px instead of floating in a narrow column.
2. Members and invites look like intentional admin tables (headers, aligned columns, clearer hierarchy) not cramped chat bubbles.
3. Instance Admin no longer feels like a legacy form — same header/card language as workspace settings, fields arranged in two columns.
4. Profile and project settings match the same shell — no more "four different apps" impression.

#### Explicitly out of scope

- IA changes (no Domains/Notifications tabs restored).
- Backend/API changes.
- New dependencies (no `clsx`/`cn` — string join per KAN-212 convention).
- `project-members-section.tsx` role-dropdown PM assignability (`TODO(PR4)`).

### Risks

- **Visual regression matrix** — 4 surfaces × 3 theme palettes × 2 appearances; no automated visual regression in web package; manual QA checklist required in design/tasks.
- **Instance Admin QA access** — super-admin test account needed for `/admin/instance` verification.
- **Responsive breakpoints** — columnar lists must degrade cleanly on narrow viewports; design should specify mobile layout explicitly.
- **Test coupling** — admin-instance tests target `data-testid`s on form fields; layout refactor must preserve testIds (low risk if IDs unchanged).
- **i18n** — new column header keys (`membersColEmail`, etc.) in en/es.
- **Scope creep into Redmine integrations layout** — redmine-section multi-card side-by-side is optional polish; defer to Slice C or follow-up if over budget.
- **400-line PR budget** — Slice B likely needs sub-split; forecast in `sdd-tasks`.

### Ready for Proposal

**Yes.** KAN-212 IA is locked and unchanged. The root cause of "looks the same" is documented: engineering extraction without layout/density restructuring. Recommend **Approach 2** with three chained slices (Shell → Lists → Admin form). `sdd-propose` should frame the user-visible win ("settings feel like a redesigned admin console, not the same cards wider") and confirm Slice A as first deliverable.

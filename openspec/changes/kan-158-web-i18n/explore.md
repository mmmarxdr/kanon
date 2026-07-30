# Explore: KAN-158 Web i18n

## Surfaces inventory

| Surface | Path | Notes |
|---------|------|-------|
| Topbar | `components/app-topbar.tsx` | VIEW_TITLES, Search, New issue, theme titles |
| Sidebar | `components/app-sidebar.tsx` | Nav: Inbox, Roadmap, Dependencies, Board, Cycles, Schedule, Settings |
| Board store labels | `stores/board-store.ts` | `STATE_LABELS` — shared by board, issue-detail, new-issue |
| StatePip | `components/ui/primitives.tsx` | Own English state labels — must use i18n |
| Inbox | `features/inbox/` | Greeting, plurals, sections, rails |
| Board | `features/board/` | Columns, cards, filters, group cards, new-issue modal |
| Issue detail | `features/issue-detail/` | Header, metadata PROPERTIES, schedule slot |
| Cycles | `features/cycles/` | List, create/close modals (markup → `Trans`) |
| Roadmap | `features/roadmap/` | Tabs Horizons/Timeline/Analytics + graph |
| Schedule | `features/schedule-timeline/` | Filters, Critical, Hide done, tooltips |
| Settings | `features/settings/` + routes | Project/workspace settings chrome |
| Palette | `components/command-palette.tsx`, `palette-filter-bar.tsx` | Commands + priority chips |
| Projects | `features/projects/create-project-modal.tsx` | Create project copy |

## Risks

1. **Shared English constants** (`STATE_LABELS`, `StatePip`) — feature-scoped work misses them; fix in foundation/chrome.
2. **Tests asserting English copy** — pin i18n to `en` in `src/test/setup.ts`.
3. **Key drift en vs es** — parity test must fail CI on missing keys.
4. **User content** — never wrap issue titles / project names in `t()`.

## Prior art

Lost uncommitted `feat/i18n` work (KAN-158 description). Terminology baseline retained from that ticket.

## Recommendation

Proceed to proposal/design. Foundation + chrome first so LanguageSwitcher is demonstrable before page rollouts.

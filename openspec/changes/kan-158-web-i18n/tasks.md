# Tasks: KAN-158 Web i18n

Strict TDD. Each phase: RED → GREEN → commit on `feat/i18n`.

## Phase 1 — Foundation
- [x] 1.1 Add `SUPPORTED_LOCALES` in `@kanon/shared` + unit test
- [x] 1.2 Add i18next deps to `@kanon/web`; create `src/i18n/` init with en/es `common`+`nav` stubs; sync `<html lang>`
- [x] 1.3 Key-parity test for all locale JSON namespaces
- [x] 1.4 Pin `i18n.changeLanguage('en')` in `src/test/setup.ts`; wrap app in provider in `main.tsx`
- [x] 1.5 `LanguageSwitcher` + test (placement relative to theme via AppTopbar test); wire into topbar

## Phase 2 — Chrome
- [x] 2.1 Translate `app-topbar` crumbs / Search / New issue / theme titles via `nav`+`common`
- [x] 2.2 Translate `app-sidebar` nav labels via `nav`
- [x] 2.3 Wire `StatePip` / state labels to `common:state.*`

## Phase 3 — Inbox
- [x] 3.1 Add `inbox` en/es catalogs; wire `features/inbox` + route chrome

## Phase 4 — Board
- [x] 4.1 Add `board` catalogs; wire columns, cards, filters, group cards

## Phase 5 — Issue detail
- [x] 5.1 Add `issue` catalogs; wire header/metadata/schedule chrome (not user body)

## Phase 6 — Cycles
- [x] 6.1 Add `cycles` catalogs; wire list + create/close modals (`Trans` if needed)

## Phase 7 — Roadmap
- [x] 7.1 Add `roadmap` catalogs; wire 3 tabs + graph chrome

## Phase 8 — Schedule
- [x] 8.1 Add `schedule` catalogs; wire timeline chrome/filters

## Phase 9 — Settings
- [x] 9.1 Add `settings` catalogs; wire settings + project-settings UI chrome

## Phase 10 — Palette + modals
- [x] 10.1 Add `palette` catalogs; wire command-palette + filter bar + new-issue + create-project modals (priority/type via `common`)

## Phase 11 — Dependencies page
- [x] 11.1 Translate remaining dependencies route chrome

## Phase 12 — Verify
- [x] 12.1 `pnpm --filter @kanon/shared test` + `pnpm --filter @kanon/web test`
- [x] 12.2 Write `verify-report.md`; transition KAN-158 → review; open PR

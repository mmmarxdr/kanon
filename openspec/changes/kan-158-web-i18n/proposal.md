# Proposal: KAN-158 — Web i18n (en/es)

## Intent

Add scalable English + Spanish UI localization to `@kanon/web` so a user can
switch language from the app topbar (next to the theme toggle) and see core
product chrome and screens in their locale. English remains the default and
fallback. Extensible to more locales later (KAN-178 Portuguese).

## Motivation

- All authenticated UI strings are hardcoded English.
- Prior `feat/i18n` work was lost uncommitted; reimplement with SDD + frequent commits.
- Spanish-speaking teams need native chrome without forking the product.

## Scope

### In Scope
- **shared**: `SUPPORTED_LOCALES` (`en`, `es`) as single source of truth.
- **web**: `i18next` + `react-i18next` + `i18next-browser-languagedetector`.
- Locale persistence via `localStorage` (`i18nextLng`); detect `localStorage → navigator → en`.
- No DB field, no URL locale prefix.
- `LanguageSwitcher` (EN|ES) left of theme toggle in `AppTopbar`; sync `<html lang>`.
- Translate page-by-page: chrome → inbox → board → issue-detail → cycles → roadmap → schedule → settings → palette/modals → dependencies.
- Domain labels (state / priority / type) in `common` namespace.
- en/es key-parity test gate; web tests pinned to `en`.

### Out of Scope
- Auth screens (login/register/forgot/reset/invite/verify).
- API error translation, emails, MCP tool descriptions.
- Portuguese (`pt`) — KAN-178.
- Translating user-generated content (issue titles, project names, comments).

## Capabilities

### New Capabilities
- `web-i18n`: locale detection/persistence, LanguageSwitcher, namespaced translation files, key parity.

### Modified Capabilities
- None at the API/MCP layer.

## Approach (locked)

- Stack: react-i18next (mature, `Trans` for markup, browser detector).
- Namespaces per area: `common`, `nav`, `inbox`, `board`, `issue`, `cycles`, `roadmap`, `schedule`, `settings`, `palette`.
- Shared primitives (`StatePip`, label maps) read translated labels via `t()` / hooks — no English-only constants left as UI source of truth.
- Rollout page-by-page with TDD (parity gate first, then per-surface wiring).

## Affected Areas

| Package | Change |
|---------|--------|
| `@kanon/shared` | `SUPPORTED_LOCALES` export |
| `@kanon/web` | i18n init, locales JSON, switcher, `t()` wiring across features |
| `openspec` | this change |
| `docs/adr` | ADR 0010 web i18n |

## Rollback

Remove deps + provider + switcher + locale JSON. No migrations. Branch discard-safe.

## Persona

Dev / PM using the web app who prefers Spanish UI chrome.

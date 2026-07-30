# ADR 0010 — Web UI localization via react-i18next

## Status
Accepted (KAN-158)

## Context
The web app ships English-only chrome. We need English + Spanish with a path to more locales, without URL restructuring or DB-backed locale preferences.

## Decision
Use `i18next` + `react-i18next` + `i18next-browser-languagedetector` in `@kanon/web`. Persist locale in `localStorage` (`i18nextLng`). Publish `SUPPORTED_LOCALES` from `@kanon/shared`. Expose a topbar LanguageSwitcher beside the theme toggle. Organize catalogs by feature namespace under `packages/web/src/i18n/locales/{lng}/*.json`. Enforce en/es key parity in tests.

## Alternatives considered
- **URL locale prefixes** — conflicts with existing TanStack Router paths; deferred.
- **next-intl** — oriented to Next.js App Router; poor fit for Vite SPA.
- **Custom React context dictionaries** — reinvent plurals/`Trans`/detection.

## Consequences
- All new UI copy MUST go through `t()` / `Trans`.
- Web tests force `lng=en`.
- Auth screens, emails, API errors, MCP copy remain out of scope until follow-ups.
- Adding a locale (e.g. `pt`) is mostly catalog + `SUPPORTED_LOCALES` entry (KAN-178).

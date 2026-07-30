# Verify report: KAN-158 Web i18n

**Date:** 2026-07-30  
**Branch:** `feat/i18n`  
**Change:** `openspec/changes/kan-158-web-i18n`

## Results

| Check | Result |
|-------|--------|
| `@kanon/shared` vitest | 100 passed |
| `@kanon/web` vitest | 911 passed / 5 todo / 0 failed |
| `tsc --noEmit` (web) | clean |
| en/es key parity | 11 namespaces gated |

## Spec coverage

| Scenario | Status |
|----------|--------|
| S1 First visit Spanish browser (detector order) | Covered by i18n init + detector config |
| S2 Persist choice (`i18nextLng`) | Covered by LanguageDetector caches |
| S3 Switcher left of theme toggle | Tested in `language-switcher.test.tsx` |
| S4 Key parity gate | `key-parity.test.ts` |
| R9 Domain labels via `common` | StatePip, board columns, metadata, palette filters |

## Surfaces wired

Foundation, LanguageSwitcher, topbar/sidebar chrome, inbox, board (+ new issue modal), issue metadata, cycles list/modals, roadmap tabs, schedule toolbar, settings tabs/members, command palette + filter bar, create-project modal, dependencies loading/error.

## Deferred (documented)

- Auth screens (login/register/…)
- Full settings invites/domains/notifications copy
- Every cycles/roadmap analytics string
- API errors, emails, MCP, `pt` (KAN-178)

## Archive readiness

Ready for PR review. Remaining string coverage can land as follow-up slices without blocking EN|ES switcher + core chrome.

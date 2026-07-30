# Spec: web-i18n

## Purpose

Define locale support for the Kanon web app (English + Spanish), including detection, persistence, LanguageSwitcher, and translation key parity.

## Requirements

### R1 — Supported locales
The system MUST expose `SUPPORTED_LOCALES` from `@kanon/shared` containing at least `en` and `es` with human display labels (`English`, `Español`).

### R2 — Detection and persistence
WHEN the web app initializes i18n, it MUST resolve language in order: `localStorage` key `i18nextLng` → browser `navigator` → fallback `en`.  
WHEN the user changes language, the system MUST persist the choice to `localStorage` and MUST set `document.documentElement.lang` to the active locale code.

### R3 — LanguageSwitcher
GIVEN the authenticated app topbar  
WHEN the LanguageSwitcher is rendered  
THEN it MUST appear immediately to the left of the theme appearance toggle.  
WHEN the user activates the switcher  
THEN the UI language MUST toggle between `en` and `es` (for the two-locale set) and visible chrome strings MUST update without a full page reload.

### R4 — Fallback
WHEN a translation key is missing in the active locale, the system MUST fall back to `en` for that key (i18next fallbackLng).

### R5 — Key parity
The test suite MUST fail if any namespace JSON key present in `en` is missing from `es`, or present in `es` but missing from `en`.

### R6 — Tests pinned to English
Web unit/component tests MUST run with i18n language forced to `en` so assertions on copy remain stable.

### R7 — No URL locale
The routing scheme MUST NOT require a locale path prefix for i18n to work.

### R8 — User content untouched
Issue titles, project names, comments, and other user-authored strings MUST NOT be passed through `t()`.

### R9 — Domain labels
Issue state, priority, and type labels shown in UI chrome MUST come from the `common` namespace (not hardcoded English maps in render).

## Scenarios

### S1 — First visit Spanish browser
GIVEN no `i18nextLng` in localStorage  
AND navigator language starts with `es`  
WHEN the app loads  
THEN the active language MUST be `es`  
AND `<html lang>` MUST be `es`.

### S2 — Persist choice
GIVEN the user selects `en` via LanguageSwitcher  
WHEN they reload the app  
THEN the active language MUST still be `en`.

### S3 — Switcher placement
GIVEN AppTopbar  
WHEN inspecting the header actions  
THEN LanguageSwitcher MUST precede the theme toggle in DOM order.

### S4 — Parity gate
GIVEN `en/nav.json` has key `board`  
AND `es/nav.json` omits `board`  
WHEN key-parity tests run  
THEN the suite MUST fail.

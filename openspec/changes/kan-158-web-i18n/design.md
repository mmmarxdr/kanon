# Design: KAN-158 Web i18n

## Decisions

### D1 — Stack: react-i18next
**Choice:** `i18next` + `react-i18next` + `i18next-browser-languagedetector`.  
**Why:** `useTranslation` / `Trans`, mature detector, works with Vite SPA.  
**Alt:** next-intl (Next-oriented); custom context (reinvents plural/`Trans`).

### D2 — Locale source: localStorage + navigator
**Choice:** detect order `localStorage → navigator → en`; key `i18nextLng`.  
**Why:** no auth/DB dependency; works on first paint after chrome mounts.  
**Alt:** URL prefix (`/es/...`) — breaks existing TanStack routes; deferred.

### D3 — SUPPORTED_LOCALES in @kanon/shared
**Choice:** `{ code, label }[]` for `en` / `es`.  
**Why:** future API/email/MCP can share the allowlist.  
**Alt:** web-only constant — rejects cross-package reuse.

### D4 — LanguageSwitcher UX
**Choice:** compact button left of theme toggle; shows active code (`EN` / `ES`); click cycles en↔es (two locales).  
**Why:** matches 28px theme control; zero new layout chrome.  
**Alt:** dropdown — overkill for two locales.

### D5 — Namespaces
`common` (state/priority/type + shared actions), `nav`, `inbox`, `board`, `issue`, `cycles`, `roadmap`, `schedule`, `settings`, `palette`.  
JSON under `packages/web/src/i18n/locales/{en,es}/<ns>.json`.

### D6 — Label maps
Replace UI consumption of English `STATE_LABELS` / `StatePip` hardcoded strings with `t('common:state.<key>')`. Keep English maps only as fallback keys or remove from render path.

## Sequence

```
boot → init i18n (sync) → I18nextProvider → App
user clicks LanguageSwitcher → i18n.changeLanguage → localStorage + <html lang> → re-render t()
```

## Files (foundation)

| File | Role |
|------|------|
| `packages/shared/src/locales.ts` | SUPPORTED_LOCALES |
| `packages/web/src/i18n/index.ts` | init + html lang sync |
| `packages/web/src/i18n/locales/{en,es}/*.json` | catalogs |
| `packages/web/src/components/language-switcher.tsx` | EN\|ES control |
| `packages/web/src/i18n/__tests__/key-parity.test.ts` | en/es key parity |
| `packages/web/src/test/setup.ts` | force `lng: 'en'` |

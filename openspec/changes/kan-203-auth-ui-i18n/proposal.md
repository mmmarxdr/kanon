# Proposal: KAN-203 Slice 1 — Auth UI i18n

## Intent

Localize unauthenticated auth screens (login, register, forgot/reset password,
verify-email, invite) and AuthLayout chrome to English + Spanish, matching the
KAN-158 react-i18next foundation.

## Scope

### In Scope
- New `auth` namespace (`locales/{en,es}/auth.json`) registered in `i18n/index.ts`
- Wire `t()` / `Trans` across auth routes + AuthLayout (quote, footer, coming-soon)
- `LanguageSwitcher` on AuthLayout form panel
- Password requirement checklist labels via `auth.passwordRequirements.*`
- en/es key parity gate (automatic once namespace listed)

### Out of Scope
- Raw API error strings (`body.message`)
- Outbound emails / InstanceSettings locale (Slice 2)
- Portuguese (KAN-178)
- Setup / profile password screens beyond shared PasswordRequirements component

## Approach

Reuse ADR-0010 patterns. Auth locale remains browser `localStorage` / switcher;
independent of instance email locale.

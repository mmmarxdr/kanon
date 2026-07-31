# Proposal: KAN-203 Slice 2 — Instance email locale

## Intent

Let the instance admin choose the language used for all outbound transactional
emails (`en` | `es`). Locale is stored on `InstanceSettings.defaultLocale`.

## Scope

### In Scope
- Prisma field + migration; GET/PATCH `/api/instance/settings`
- Admin UI select on `/admin/instance`
- Email template builders accept `locale` and render from en/es dictionaries
- Call sites resolve locale via `getInstanceLocale()` (instance only)

### Out of Scope
- Per-user locale / Accept-Language override
- In-app notification body translation
- Portuguese (KAN-178)
- Auth UI (Slice 1)

## Approach

Dictionaries live under `packages/api/src/services/email/i18n/`. Builders default
to `en` for backward-compatible unit tests; production send paths always pass
the instance locale.

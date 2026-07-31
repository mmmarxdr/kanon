# Spec: Auth UI i18n

## Capability: auth-ui-i18n

### Requirement: Auth screens use the auth namespace

Auth chrome and form copy on login, register, forgot-password, reset-password,
verify-email, and invite MUST render via `useTranslation("auth")` (or `Trans`)
with keys present in both `en` and `es` catalogs.

#### Scenario: Login in Spanish

- **GIVEN** `i18nextLng=es`
- **WHEN** the user opens `/login`
- **THEN** primary CTA and heading are Spanish (not hardcoded English)

#### Scenario: Language switcher on auth layout

- **GIVEN** an auth page using AuthLayout
- **WHEN** the page renders
- **THEN** `LanguageSwitcher` is visible (test id `language-switcher`)
- **AND** cycling language updates auth copy without full reload

#### Scenario: Key parity

- **GIVEN** the web i18n parity suite
- **WHEN** it runs for namespace `auth`
- **THEN** flattened en and es key sets are identical

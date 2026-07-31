# Spec: Instance email locale

## Capability: instance-email-locale

### Requirement: Admin configures defaultLocale

Super-admins MUST be able to set `defaultLocale` to a supported locale (`en` or
`es`) via PATCH `/api/instance/settings` and the `/admin/instance` UI.

#### Scenario: Persist Spanish as instance locale

- **GIVEN** a super-admin
- **WHEN** they PATCH `{ "defaultLocale": "es" }`
- **THEN** GET settings returns `defaultLocale: "es"`

### Requirement: Outbound emails use instance locale

Verify, reset, magic-link, invite, assignment, mention, and cycle-closed emails
MUST use copy from the dictionary for `InstanceSettings.defaultLocale`.

#### Scenario: Magic-link subject in Spanish

- **GIVEN** `defaultLocale` is `es`
- **WHEN** a magic-link email is built with that locale
- **THEN** the subject is Spanish (not the English default)

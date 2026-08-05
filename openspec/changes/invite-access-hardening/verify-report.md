# Verify Report: invite-access-hardening (KAN-222)

## Mode
Strict TDD — schema/authz/list/invite apply covered by unit + integration tests.

## Scenarios

| Spec | Result | Evidence |
|------|--------|----------|
| S1 assigned no PM | PASS | `project-list-visibility.integration.test.ts` |
| S2 assigned with PM | PASS | same |
| S3 workspace mode | PASS | same + invite accept workspace-scope |
| S4 owner bypass | PASS | same |
| S5 token intersect | PASS | same |
| S6 accept workspace invite | PASS | `invite.integration.test.ts` |
| S7 accept assigned invite | PASS | same |
| Web invite scopes + picker | PASS | `invites-section.test.tsx` (4) |
| enforceProjectAccess workspace mode | PASS | `require-role.test.ts` |

## Commands

```shell
pnpm --filter @kanon/api exec vitest run \
  src/middleware/require-role.test.ts \
  src/modules/invite/schema.test.ts \
  src/modules/invite/service.test.ts \
  src/modules/project/project-list-visibility.integration.test.ts \
  src/modules/invite/invite.integration.test.ts

pnpm --filter @kanon/web exec vitest run \
  src/features/settings/invites-section.test.tsx
```

All green.

## Notes

- MCP `kanon_list_projects` inherits filtered `GET /workspaces/:wid/projects` (no MCP-only filter needed).
- Existing members remain `projectAccess=assigned` via migration default.

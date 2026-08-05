# Verify Report: instance-users-admin (KAN-224)

## Mode
Strict TDD — API integration tests written first; web page + sidebar covered by focused component tests.

## Scenarios

| Spec / slice | Result | Evidence |
|--------------|--------|----------|
| Gate 401/403 | PASS | `admin-users.integration.test.ts` |
| List + search + verified + pagination | PASS | same |
| Detail memberships + assigned projects | PASS | same |
| Workspace/project pickers | PASS | same |
| Verify email idempotent | PASS | same |
| Membership add/patch/remove + replace projects | PASS | same |
| Bulk verify + remove_from_workspace | PASS | same |
| Web list/search/bulk/detail | PASS | `admin-users-page.test.tsx` (4) |
| Sidebar users nav (instance-admin) | PASS | `app-sidebar.test.tsx` |

## Commands

```shell
pnpm --filter @kanon/api exec vitest run \
  src/modules/admin-users/admin-users.integration.test.ts

pnpm --filter @kanon/web exec vitest run \
  src/features/admin-users/admin-users-page.test.tsx \
  src/components/__tests__/app-sidebar.test.tsx
```

All green (API 10, web 18 including pre-existing sidebar cases).

## Notes

- No new Prisma models; mutations wrap `member/service` + `project-member-service` with `actingRole=owner`.
- Out of v1: disable/delete users, toggle `isInstanceAdmin`, workspace Members redesign, MCP.

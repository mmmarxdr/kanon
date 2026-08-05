# Design: instance-users-admin

## Authz

All routes: `requireInstanceAdmin`. Mutations that wrap workspace services use `actingRole = "owner"` so an instance admin who is not a member of the target workspace can still manage it; last-owner / owner-cap rules remain in `member/service`.

## Endpoints

See proposal. Bulk body:

```text
{ action: "verify_email" | "remove_from_workspace", userIds: uuid[], workspaceId?: uuid }
```

`remove_from_workspace` requires `workspaceId`. Response: `{ results: [{ userId, ok, error? }] }`.

## List query

- `q`: case-insensitive email contains
- `verified`: `true` | `false` | omit
- `limit` default 20 max 50, `offset` default 0
- Response: `{ users, total, limit, offset }`

## Detail

Memberships include `projectAccess`.

- `projectAccess === "workspace"` → `projects: null` (all active workspace projects; not an empty assignment list).
- `projectAccess === "assigned"` → `projects: [...]` (may be `[]` when zero ProjectMember rows).

`PUT .../memberships/:memberId/projects` **rejects** (`422 INVALID_PROJECT_ACCESS`) when `projectAccess !== "assigned"`. It does not clear or touch ProjectMember rows in workspace mode. Switching `projectAccess` via PATCH does not auto-delete/create ProjectMember rows; assigned lists are managed only via PUT.

## Assignment pickers (admin-only)

Instance admins are not necessarily members of every workspace, so the page cannot reuse `GET /workspaces` / `GET /workspaces/:wid/projects` (member-gated). Same module exposes:

- `GET /api/admin/users/workspaces`
- `GET /api/admin/users/workspaces/:workspaceId/projects`

## UI

`/admin/users`: search, table, selection + bulk bar, detail panel. i18n en/es (`admin` namespace).

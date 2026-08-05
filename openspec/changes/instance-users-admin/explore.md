# Explore: instance-users-admin

## Current state

- Workspace Members: `GET/POST/PATCH/DELETE /api/workspaces/:wid/members` — unpaginated, no email search.
- Project Members: `/api/projects/:key/members` — scoped to one project.
- Instance admin UI: `/admin/instance` (super-admin settings only) — no user directory.
- No admin verify-email endpoint; `User.emailVerifiedAt` exists.

## Product need

Instance admins manage all users on the self-hosted instance: find by email, see WS/project access (incl. KAN-222 `projectAccess`), vouch email, edit memberships, bulk verify / remove-from-workspace.

## Reuse

- `member/service.ts` add/change/remove
- `project-member-service.ts` + `createProjectMembersInTx`
- `requireInstanceAdmin`
- Web `SettingsShell` / `SettingsList` + sidebar admin block

## Gaps

Instance-wide User list API, pagination, admin verify, orchestrated membership edits for non-WS-member admins, dedicated `/admin/users` page.

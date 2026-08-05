# Proposal: Instance users admin directory

## Intent

Give instance admins a single Users screen to find people, inspect workspace/project access, verify emails, and fix assignments without hopping workspace Settings tabs.

**Persona:** instance admin / owner operating a self-hosted Kanon.

## Scope

### In Scope (v1)
- `GET /api/admin/users` paginated + `q` email search + verified filter
- `GET /api/admin/users/:userId` detail with memberships/projects
- Verify email; membership add/remove/patch; replace assigned projects
- Bulk verify_email + remove_from_workspace
- Web `/admin/users` + sidebar link for `isInstanceAdmin`

### Out of Scope
- Workspace Settings Members redesign
- Disable/delete user, toggle `isInstanceAdmin`
- MCP tools

## Approach

Thin `admin-users` module orchestrating existing member/project-member services. Instance-admin mutations call those services with acting role `owner` (cross-workspace privilege) while preserving last-owner and owner-cap guards.

## Rollback

Remove routes + web page. No schema migration. Rollback removes the feature only — it does **not** reverse email verifications, memberships, or project assignments already applied through the admin APIs. Recover those via the same admin surface (or workspace member APIs) / DB ops as needed.

## Success Criteria

- [ ] Instance admin lists/searches users with pagination
- [ ] Detail shows memberships + projectAccess + projects
- [ ] Verify email and membership edits work via reused services
- [ ] Bulk verify and remove-from-workspace return per-id results

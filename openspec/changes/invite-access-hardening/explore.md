# Explore: invite-access-hardening (KAN-222)

## Symptom

Invitee joins a dedicated workspace, sees its project in the sidebar, opens it →
`403 FORBIDDEN` / "You are not assigned to this project".

## Prior art

| Issue | What shipped | Gap |
|-------|--------------|-----|
| KAN-16 | `enforceProjectAccess`: member/viewer need `ProjectMember`; owner/admin bypass | List endpoint never applied the same rule |
| KAN-79 | Token `allowedProjectIds` filters list + open | Membership visibility still missing on list |
| KAN-221 | Web invite form: workspace / all / selected → `projectAssignments` | Default "workspace only" creates **zero** PMs; copy says membership ≠ access |
| KAN-222 (original) | Planned list filter by PM only | Too narrow: product wants workspace scope = all WS projects incl. future |

## Current code paths

- List: `GET /api/workspaces/:wid/projects` → `requireMember` → `listProjects(wid, tokenScope)` — all non-archived projects.
- Open: `GET /api/projects/:key` → `requireProjectMember` → PM required for non-admin.
- Accept: `acceptInvite` / register / onboard → `Member` + optional `createProjectMembersInTx`.
- MCP `kanon_list_projects` → same list API.

## Product decision (confirmed)

1. Invite **workspace** → access to all active projects in that workspace (incl. later-created).
2. Invite **all** / **selected** → access to those projects only (snapshot via PM rows).
3. List surfaces (web + MCP) MUST equal openable set.

## Design implication

Cannot infer workspace-wide vs assigned-empty from PM count alone. Need explicit
`Member.projectAccess` (`workspace` | `assigned`). Invite persists the same enum.

## Non-goals

- Backfill existing members to workspace-wide access.
- Instance-level multi-workspace invite token.
- Different per-project roles on invite (keep invite role).

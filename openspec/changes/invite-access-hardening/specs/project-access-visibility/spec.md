# Spec: project-access-visibility

## Capability

Membership project-access mode aligned across list, open, and invite accept.

## Requirements

### R1 — Member.projectAccess
The system MUST persist `Member.projectAccess` as `workspace` or `assigned`.
Existing members MUST default to `assigned`.

### R2 — Workspace mode open
WHEN a workspace `member`/`viewer` has `projectAccess = workspace`,
THEY MUST be able to open any non-archived project in that workspace
(subject to token scope), with effective project role equal to their workspace role.

### R3 — Assigned mode open
WHEN a workspace `member`/`viewer` has `projectAccess = assigned`,
THEY MUST require a `ProjectMember` row to open a project (KAN-16 preserved).

### R4 — List equals openable set
`GET /api/workspaces/:wid/projects` MUST return exactly the projects the caller
can open under R2/R3/owner-admin bypass, intersected with token `allowedProjectIds`
when the allowlist is non-empty.

### R5 — Owner/admin bypass
Workspace `owner`/`admin` MUST list and open all active workspace projects
regardless of `projectAccess` / `ProjectMember` (token scope still applies).

### R6 — Invite workspace scope
WHEN an invite is created with `projectAccess = workspace`,
AND a user accepts it,
THEN the created `Member.projectAccess` MUST be `workspace`.

### R7 — Invite assigned scope
WHEN an invite is created with `projectAccess = assigned` and non-empty
`projectAssignments`,
AND a user accepts it,
THEN `Member.projectAccess` MUST be `assigned` AND corresponding `ProjectMember`
rows MUST exist.

### R8 — Invite list metadata
`GET /api/workspaces/:wid/invites` MUST include `projectAccess` and enough
assignment summary for admins to see what a link grants.

### R9 — MCP parity
`kanon_list_projects` MUST only surface projects returned by R4 (API source of truth).

## Scenarios

### S1 — Unassigned assigned-mode member
- **Given** member with `projectAccess=assigned` and no PM for project P
- **When** they `GET /workspaces/:wid/projects` and `GET /projects/P`
- **Then** list omits P and open returns 403

### S2 — Assigned PM
- **Given** member with `projectAccess=assigned` and PM for P
- **When** they list and open P
- **Then** list includes P and open returns 200

### S3 — Workspace mode
- **Given** member with `projectAccess=workspace` and no PM rows
- **When** they list and open any active project in the workspace
- **Then** both succeed

### S4 — Owner bypass
- **Given** workspace owner with no PM rows
- **When** they list projects
- **Then** all active projects are returned

### S5 — Token scope intersection
- **Given** workspace-mode member with token allowlist `[P1]`
- **When** they list projects in a workspace that has P1 and P2
- **Then** only P1 is returned; open P2 is 403

### S6 — Accept workspace invite
- **Given** invite with `projectAccess=workspace`
- **When** user accepts
- **Then** member has `projectAccess=workspace` and can open projects

### S7 — Accept selected invite
- **Given** invite with `projectAccess=assigned` and assignments `[P1]`
- **When** user accepts
- **Then** member is `assigned`, has PM for P1 only, list shows only P1

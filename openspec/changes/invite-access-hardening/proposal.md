# Proposal: Invite access hardening (KAN-222)

## Intent

When an admin invites someone to a workspace (or to specific projects), the invitee
MUST be able to open every project the invite granted — and MUST NOT see projects
they cannot open. Today list visibility and open authz disagree, so onboarding
fails with a predictable 403.

**Personas:** workspace admin creating invites; invitee joining via web/MCP.

## Scope

### In Scope
- Prisma: `ProjectAccess` enum; `Member.projectAccess` (default `assigned`);
  `WorkspaceInvite.projectAccess` (default `workspace`)
- Authz: `enforceProjectAccess` honors `projectAccess === workspace`
- List: `GET /api/workspaces/:wid/projects` returns only openable projects
  (owner/admin | workspace mode | ProjectMember) ∩ token scope
- Invite create/accept/register/onboard set `projectAccess` + PMs for all/selected
- Web: corrected scope copy, workspace picker (admin/owner workspaces), invite list
  shows access summary
- MCP: inherits API filter; regression coverage via API integration
- Strict TDD tests for list/open/invite paths

### Out of Scope
- Auto-backfilling existing members to `workspace` access
- Instance-level single invite spanning multiple workspaces
- Per-project role different from invite role
- Changing owner/admin bypass semantics

## Capabilities

### New Capabilities
- `project-access-visibility`: membership access mode + list/open alignment for
  workspace invites and project assignment

### Modified Capabilities
- Workspace invite create/accept semantics (workspace scope now grants project access)

## Approach

Explicit `projectAccess` on `Member` / `WorkspaceInvite`:
- `workspace` → list+open all active WS projects (effective role = workspace role)
- `assigned` → list+open only `ProjectMember` rows

Existing members migrate to `assigned` (preserves KAN-16 least-privilege for current data).
New workspace-scoped invites set `workspace`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/api` | Modified + migration | Schema, middleware, project list, invite service |
| `packages/web` | Modified | Invites UI copy, workspace picker, list metadata |
| `packages/mcp` | Indirect | `list_projects` via filtered API |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Existing members unexpectedly unlock all projects | Low | Default `assigned` on Member |
| Invite "workspace" meaning change surprises admins | Med | UI copy + list metadata |
| Prisma rollback | Low | Drop columns + enum |

## Rollback Plan

Do **not** drop `project_access` while workspace-mode members exist without a
backfill — those members have no `ProjectMember` rows and would lose all
project access under the pre-KAN-222 PM-only gate.

Safe rollback sequence:
1. Keep `project_access` schema and a compatible authorization path, **or**
2. Before reverting authz: for each `Member.projectAccess = workspace`, insert
   `ProjectMember` rows for every active project in that workspace (snapshot —
   future projects will not be covered), then set those members to `assigned`.
3. Only then revert list/open gates / UI. Dropping the enum without step 2 is
   unsafe.

## Success Criteria

- [ ] Workspace-scoped invitee opens every active project in that workspace
- [ ] Selected-project invitee lists/opens only those projects
- [ ] Sidebar and MCP list never show FORBIDDEN-by-design projects
- [ ] Owner/admin still see all; token scope still intersects
- [ ] Focused + integration tests green for new scenarios

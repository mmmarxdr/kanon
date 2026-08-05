# Apply progress: invite-access-hardening

## Done
- Prisma `ProjectAccess` enum + `Member.projectAccess` / `WorkspaceInvite.projectAccess`
- `enforceProjectAccess` workspace-mode bypass
- `listProjects` visibility aligned with open gates (+ token scope)
- Invite create/accept/onboard persist and apply `projectAccess`
- Invite list metadata (`projectAccess`, `projectAssignmentCount`)
- Web: workspace picker, corrected copy, payload includes `projectAccess`
- `GET /api/workspaces` includes caller `role` for picker
- Focused tests green (verify-report.md)

## Branch
`feat/invite-access-hardening`

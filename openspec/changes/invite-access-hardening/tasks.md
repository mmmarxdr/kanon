# Tasks: invite-access-hardening

## 1. Schema
- 1.1 Add `ProjectAccess` enum + columns on `Member` / `WorkspaceInvite`; generate migration
- 1.2 `pnpm --filter @kanon/api db:generate`

## 2. Authz + list (TDD)
- 2.1 RED: middleware tests for `projectAccess=workspace` open bypass
- 2.2 GREEN: `enforceProjectAccess` reads `projectAccess`
- 2.3 RED: project list integration — assigned omit / assigned include / workspace all / owner / token
- 2.4 GREEN: `listProjects` + route pass member context

## 3. Invite apply (TDD)
- 3.1 RED: createInvite persists `projectAccess`; reject assigned+empty
- 3.2 GREEN: createInvite schema/service
- 3.3 RED: accept/register/onboard set Member.projectAccess
- 3.4 GREEN: accept paths
- 3.5 GREEN: listInvites returns projectAccess + assignment summary

## 4. Web
- 4.1 RED/GREEN: invites-section copy, default workspace semantics, workspace picker
- 4.2 Update create mutation payload + invite row metadata

## 5. Verify
- 5.1 Run api + web focused suites
- 5.2 Write verify-report.md; move KAN-222 to review

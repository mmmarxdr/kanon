# Proposal: Active workspace persistence + sidebar switcher (KAN-204)

## Intent

Fix B9: selecting a workspace is not persisted, so sidebar projects, settings,
inbox, and SSE stay scoped to `workspaces[0]` (oldest). Add a quick
WorkspaceSwitcher in the sidebar header without breaking `/workspaces` create.

## Motivation

Users with multiple workspaces switch on `/workspaces`, open a board, and still
see the other workspace’s projects in the sidebar. Header shows a phantom
“Kanon / workspace” label.

## Scope

### In Scope
- Persist `activeWorkspaceId` (zustand + localStorage)
- Resolve against membership; stale id falls back to first workspace
- Writers: select, create, URL sync on project-select
- Invalidate project lists on change
- Sidebar header WorkspaceSwitcher → set active + navigate `/inbox`
- Keep footer “New workspace” → `/workspaces`

### Out of Scope
- URL restructure (`/w/:slug/...`)
- API changes
- Portuguese locale

## Approach

Web-only. `useActiveWorkspaceId()` becomes the single resolver; existing callers
auto-heal. OpenSpec + implementation in one PR.

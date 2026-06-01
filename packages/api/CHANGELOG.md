# Changelog — @kanon/api

## [Unreleased]

### BREAKING

- **Project-scoped routes now return 404 (not 403) for users outside the project's workspace.**
  Previously, requesting a project key that exists but belongs to a workspace the user is not a
  member of returned 403. With the workspace-scoped key resolution introduced in KAN-16 (PR2),
  the project is invisible to outsiders — the lookup returns no result and the route returns 404.
  This prevents cross-workspace existence leakage. Clients that relied on 403 as a signal that
  a project exists but is inaccessible must now treat 404 as the definitive "no access or does
  not exist" response for project-keyed routes.
  **Ref: KAN-16 (R-KAN16-bug)**

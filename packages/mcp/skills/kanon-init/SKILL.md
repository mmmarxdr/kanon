---
name: kanon-init
description: Automated project onboarding — scan codebase, create Kanon project, seed initial issues, groups, and roadmap items from TODOs and architecture gaps
version: 2.0.0
tags: [kanon, onboarding, project-setup, codebase-scan, batch]
---

# Kanon Init — Automated Project Onboarding

Scan the current codebase, resolve or create a Kanon project, seed issues and roadmap items from TODO/FIXME comments and architecture gaps, and report results. One command takes a repo from unknown to fully tracked.

Supports two modes:
- **Interactive** (user-invoked): workspace selection + single confirmation before creation
- **Batch** (sub-agent): zero interaction, workspace/project params passed as inputs

---

## Prerequisites

The Kanon MCP server must be configured and reachable. Call `kanon_list_workspaces()` to verify connectivity. If it fails, stop and tell the user to check their MCP configuration.

---

## Phase 1: Discover

Scan the codebase to understand its structure, tech stack, and areas of concern.

### 1a: Directory Structure and Area Derivation

Scan top-level directories and workspace packages. Map directories to human-readable groups:

| Directory pattern | groupKey | Group name |
|---|---|---|
| `packages/api`, `api/`, `server/` | `api` | API |
| `packages/web`, `web/`, `client/`, `frontend/` | `web` | Frontend |
| `packages/mcp` | `mcp` | MCP |
| `packages/cli`, `cli/` | `cli` | CLI |
| `infra/`, `deploy/`, `docker/`, `.github/`, `terraform/`, `k8s/` | `infra` | Infrastructure |
| `packages/{name}` (any other) | `{name}` | (Capitalize directory name) |
| `src/{subdir}` (flat project) | `{subdir}` | (Capitalize subdir name) |

Cap at 5 groups. Priority: API > Frontend > Infrastructure > others alphabetically.

### 1b: Tech Stack Detection

Read manifest files (`package.json`, `go.mod`, `Cargo.toml`, `pyproject.toml`) at the project root and workspace package roots. Detect frameworks, databases, testing tools, and build tools from dependencies.

### 1c: TODO/FIXME Scan

Search all source files for `TODO`, `FIXME`, `HACK`, `XXX` comments (limit to 20 matches). Filter out bare markers with no descriptive text.

### 1d: Architecture Gap Detection

Check for these paths. Missing = gap:

| Path to check | Gap if missing |
|---|---|
| `.github/workflows/` | CI/CD pipeline |
| `Dockerfile` or `docker-compose.yml` | Containerization |
| `.eslintrc*` or `eslint.config.*` | Linting configuration |
| `vitest.config.*` or `jest.config.*` | Test configuration |
| `README.md` | Project documentation |
| `docs/` | Documentation directory |

### 1e: Derive Project Metadata

From the scan, derive:
- **Project name**: from `package.json` `name` field, `go.mod` module, or directory name
- **Project key**: uppercase, max 6 chars, derived from name (e.g., "kanon" -> "KAN"). Must match `^[A-Z][A-Z0-9]*$`
- **Description**: from README first line or `package.json` description, or "No description found"

---

## Phase 2: Resolve Project

### 2a: Workspace Selection

- **Batch mode** (`workspaceId` provided): Use the provided `workspaceId`. No prompts.
- **Interactive mode**: Call `kanon_list_workspaces()`. If one workspace, auto-select. If multiple, ask user.

### 2b: Project Lookup

Call `kanon_list_projects(workspaceId)`.

- If a project with the derived key already exists: reuse it.
- If no match: create the project via `kanon_create_project(...)`.

---

## Phase 3: Seed Content

### 3a: Idempotency Check

Call `kanon_list_issues(projectKey)` and `kanon_list_roadmap(projectKey)` to skip items whose title matches an existing issue or roadmap item.

### 3b: Interactive Confirmation (interactive mode only)

In interactive mode, present a confirmation table of proposed items before creating.

### 3c: Issue Creation

Create issues in priority order, respecting a total cap of 10 issues:

1. **FIXME bugs** (up to 3): Type `bug`, priority `high`
2. **Architecture gaps** (up to 4): Type `task`, priority `medium`
3. **TODO tasks** (up to 3): Type `task`, priority `medium`

Title format: `[Area] Verb phrase` (e.g., `[API] Add request validation middleware`)

### 3d: Roadmap Item Creation

Create roadmap items for larger concerns. Cap at 5 items. Status: `idea` for all.

| Gap detected | Roadmap title | Horizon | Effort | Impact |
|---|---|---|---|---|
| No CI/CD pipeline | Add CI/CD pipeline | `now` | 3 | 5 |
| No test configuration | Set up test infrastructure | `now` | 2 | 4 |
| No docs/ directory | Add project documentation | `next` | 2 | 3 |
| No Dockerfile | Add containerization | `next` | 2 | 3 |
| No linting config | Set up linting and formatting | `later` | 1 | 2 |

### 3e: Error Handling

If any individual MCP call fails, log a warning and continue. Do not abort the entire flow.

---

## Phase 4: Report

Present a summary table with counts of created/skipped items.

---

## Best Practices

1. Clean titles for seeded issues -- expand terse TODO comments into proper `[Area] Description` titles.
2. Respect caps -- 10 issues, 5 roadmap items, 5 groups. Quality over quantity.
3. Fail gracefully -- if any MCP call fails during seeding, log a warning and continue.
4. Idempotency first -- always check for existing items before creating. A second run should produce zero duplicates.

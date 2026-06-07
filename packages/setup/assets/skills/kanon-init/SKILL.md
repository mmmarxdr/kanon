---
name: kanon-init
description: Automated project onboarding — scan codebase, create Kanon project, seed initial issues, groups, and roadmap items from TODOs and architecture gaps
version: 2.0.0
tags: [kanon, onboarding, project-setup, codebase-scan, batch]
allowed-tools:
  - kanon_*
  - mem_save
  - mem_search
  - mem_get_observation
---

# Kanon Init — Automated Project Onboarding

Scan the current codebase, resolve or create a Kanon project, seed issues and roadmap items from TODO/FIXME comments and architecture gaps, and report results. One command takes a repo from unknown to fully tracked.

Supports two modes:
- **Interactive** (user-invoked via `/kanon-init`): workspace selection + single confirmation before creation
- **Batch** (sub-agent): zero interaction, workspace/project params passed as inputs

---

## Trigger

`/kanon-init`, `init project`, new project onboarding

---

## Inputs

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `workspaceId` | string | No | If provided, skip workspace selection (batch mode) |
| `projectKey` | string | No | If provided, skip project creation and seed into existing project |
| `projectName` | string | No | Override the derived project name |

**Mode detection**: If `workspaceId` is provided, run in **batch mode** (zero prompts). Otherwise, **interactive mode**.

---

## Prerequisites

Load Kanon MCP tools via ToolSearch. If tools are not available, stop and tell the user to configure the Kanon MCP server.

Call `kanon_list_workspaces()` to verify connectivity. If it fails, stop and report the MCP server is not reachable.

---

## Phase 1: Discover

Scan the codebase to understand its structure, tech stack, and areas of concern.

### 1a: Directory Structure and Area Derivation

Scan top-level directories and workspace packages:

```
Glob("*")           -> top-level dirs and files
Glob("packages/*")  -> monorepo packages (if packages/ exists)
Glob("src/*")       -> flat project subdirs (if no packages/)
```

Map directories to human-readable groups. **Cap at 5 groups.**

| Directory pattern | groupKey | Group name |
|---|---|---|
| `packages/api`, `api/`, `server/` | `api` | API |
| `packages/web`, `web/`, `client/`, `frontend/` | `web` | Frontend |
| `packages/mcp` | `mcp` | MCP |
| `packages/cli`, `cli/` | `cli` | CLI |
| `infra/`, `deploy/`, `docker/`, `.github/`, `terraform/` | `infra` | Infrastructure |
| `packages/{name}` (any other) | `{name}` | (Capitalize name) |
| `src/{subdir}` (flat project) | `{subdir}` | (Capitalize subdir) |

**Priority when capping at 5**: API > Frontend > Infrastructure > others alphabetically.

### 1b: Tech Stack Detection

Read manifest files at project root (and workspace package roots for monorepos):

| File | Extract |
|------|---------|
| `package.json` | `name`, `description`, `dependencies`, `workspaces` |
| `go.mod` | Module path, Go version |
| `Cargo.toml` | Package name, dependencies |
| `pyproject.toml` | Project name, dependencies |

Detect frameworks, databases, testing tools, and build tools from dependencies.

### 1c: TODO/FIXME Scan

```
Grep(pattern: "TODO|FIXME|HACK|XXX", output_mode: "content", head_limit: 20)
```

Filter out bare markers with no descriptive text. Keep entries with meaningful text after the marker.

### 1d: Architecture Gap Detection

Check for these paths. Missing = gap.

| Path to check | Gap if missing |
|---|---|
| `.github/workflows/` | CI/CD pipeline |
| `Dockerfile` or `docker-compose.yml` | Containerization |
| `.eslintrc*` or `eslint.config.*` | Linting configuration |
| `vitest.config.*` or `jest.config.*` | Test configuration |
| `README.md` | Project documentation |
| `docs/` | Documentation directory |

### 1e: README Content

If `README.md` exists, read the first 50 lines to extract the project's stated purpose.

### 1f: Derive Project Metadata

- **Project name**: from `package.json` `name`, `go.mod` module, or directory name
- **Project key**: uppercase, max 6 chars, derived from name (e.g., "kanon" -> "KAN"). Must match `^[A-Z][A-Z0-9]*$`
- **Description**: from README first line or `package.json` description

---

## Phase 2: Resolve Project

### 2a: Workspace Selection

- **Batch mode**: Use provided `workspaceId`.
- **Interactive mode**: Call `kanon_list_workspaces()`. If one workspace, auto-select. If multiple, ask user. If none, stop.

### 2b: Project Lookup

Call `kanon_list_projects(workspaceId)`.

- If project with derived key exists: reuse it.
- If no match: create via `kanon_create_project`.

---

## Phase 3: Seed Content

### 3a: Idempotency Check

Call `kanon_list_issues` and `kanon_list_roadmap` once, cache results. Skip items whose title matches an existing issue or roadmap item.

### 3b: Interactive Confirmation (interactive mode only)

Present a confirmation table before creating anything:

```
## Proposed Items

| # | Type | Title | Group |
|---|------|-------|-------|
| 1 | issue | [API] Fix N+1 query in user list | api |
| 2 | issue | [Infra] Set up GitHub Actions | infra |
| 11 | roadmap | Add test infrastructure | - |

Create all {N} items? (y/n)
```

In **batch mode**, skip this step.

### 3c: Issue Creation

Create issues in priority order, **cap at 10 issues**:

1. **FIXME bugs** (up to 3): type `bug`, priority `high`
2. **Architecture gaps** (up to 4): type `task`, priority `medium`
3. **TODO tasks** (up to 3): type `task`, priority `medium`

If fewer items in a category, overflow budget to next.

#### Title Format

Always use: `[Area] Verb phrase`

Good: `[API] Add request validation middleware`
Bad: `TODO fix auth`

### 3d: Roadmap Item Creation

Create roadmap items for larger concerns. **Cap at 5 items.** Status: `idea` for all.

| Gap detected | Roadmap title | Horizon | Effort | Impact |
|---|---|---|---|---|
| No CI/CD pipeline | Add CI/CD pipeline | `now` | 3 | 5 |
| No test configuration | Set up test infrastructure | `now` | 2 | 4 |
| No docs/ directory | Add project documentation | `next` | 2 | 3 |
| No Dockerfile | Add containerization | `next` | 2 | 3 |
| No linting config | Set up linting and formatting | `later` | 1 | 2 |

### 3e: MCP Call Sequence

1. `kanon_list_issues(projectKey)` — cache for dedup
2. `kanon_list_roadmap(projectKey)` — cache for dedup
3. For each issue: `kanon_create_issue(...)` — skip duplicates
4. For each roadmap item: `kanon_create_roadmap_item(...)` — skip duplicates

If any MCP call fails, log a warning and continue.

---

## Phase 4: Report

### 4a: Summary Table

```
## Kanon Init Summary

| Category | Count | Details |
|----------|-------|---------|
| Project | 1 | {KEY} ({created | reused}) |
| Groups | {N} | {group1}, {group2}, ... |
| Issues created | {N} | {X} bugs, {Y} tasks |
| Issues skipped | {N} | - |
| Roadmap items created | {N} | - |
| Roadmap items skipped | {N} | - |
```

### 4b: Save to Engram

Save project onboarding context with `topic_key: kanon-project/{KEY}`.

---

## Edge Cases

- **No recognizable project files**: Derive metadata from directory name. Still allow project creation.
- **Key exceeds 6 characters**: Truncate intelligently. Prefer acronyms.
- **Project key already exists**: Reuse the existing project.
- **Very large codebase**: The 20-match grep cap and 10-issue cap prevent overwhelming the board.
- **Re-run on onboarded project**: Idempotency check prevents duplicates.
- **No TODOs found**: Skip TODO-derived issues. Architecture-gap issues still created.
- **MCP call failure**: Log warning and continue. Never block the entire flow.

---

## Best Practices

1. **Clean titles for seeded issues** — Expand terse TODO comments into proper `[Area] Description` titles.
2. **Respect all caps** — 10 issues, 5 roadmap items, 5 groups. Quality over quantity.
3. **Save to engram** — The onboarding context is valuable for future sessions.
4. **Fail gracefully** — If any MCP call fails, log and continue.
5. **Idempotency first** — Always check for existing items before creating.
6. **One project per run** — For monorepos, suggest running once per sub-project.

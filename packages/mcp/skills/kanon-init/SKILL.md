---
name: kanon-init
description: Automated project onboarding — scan codebase, create Kanon project, seed initial issues, groups, and roadmap items from TODOs and architecture gaps
version: 2.0.0
tags: [kanon, onboarding, project-setup, codebase-scan, batch]
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

The skill accepts optional inputs. When invoked by a sub-agent or orchestrator, these are passed directly. When invoked interactively, they are derived during execution.

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `workspaceId` | string | No | If provided, skip workspace selection (batch mode) |
| `projectKey` | string | No | If provided, skip project creation and seed into existing project |
| `projectName` | string | No | Override the derived project name |

**Mode detection**: If `workspaceId` is provided as input, run in **batch mode** (zero prompts). Otherwise, run in **interactive mode**.

---

## Prerequisites

Before starting, load the Kanon MCP tools via ToolSearch:

```
ToolSearch: select:mcp__kanon__kanon_list_workspaces,mcp__kanon__kanon_create_project,mcp__kanon__kanon_list_projects,mcp__kanon__kanon_list_issues,mcp__kanon__kanon_create_issue,mcp__kanon__kanon_list_roadmap,mcp__kanon__kanon_create_roadmap_item,mcp__kanon__kanon_get_project,mcp__kanon__kanon_list_groups
```

If ToolSearch returns no results, the Kanon MCP server is not configured. Stop and tell the user:
> "The Kanon MCP server is not configured in your Claude Code settings. Add the Kanon MCP server configuration and try again."

Call `kanon_list_workspaces()` to verify connectivity. If it fails, stop and tell the user:
> "The Kanon MCP server is not reachable. Make sure the Kanon API is running, the MCP server is configured in your Claude Code settings, and the `KANON_API_KEY` environment variable is set."

Do NOT proceed past this point if connectivity fails.

---

## Phase 1: Discover

Scan the codebase to understand its structure, tech stack, and areas of concern.

### 1a: Directory Structure and Area Derivation

Scan top-level directories and workspace packages:

```
Glob("*")           → top-level dirs and files
Glob("packages/*")  → monorepo packages (if packages/ exists)
Glob("src/*")       → flat project subdirs (if no packages/)
```

Map directories to human-readable groups using this table. Apply in order, first match wins per directory. **Cap at 5 groups.**

| Directory pattern | groupKey | Group name |
|---|---|---|
| `packages/api`, `api/`, `server/` | `api` | API |
| `packages/web`, `web/`, `client/`, `frontend/` | `web` | Frontend |
| `packages/mcp` | `mcp` | MCP |
| `packages/cli`, `cli/` | `cli` | CLI |
| `infra/`, `deploy/`, `docker/`, `.github/`, `terraform/`, `k8s/` | `infra` | Infrastructure |
| `packages/{name}` (any other) | `{name}` | (Capitalize directory name) |
| `src/{subdir}` (flat project) | `{subdir}` | (Capitalize subdir name) |

**Priority when capping at 5**: API > Frontend > Infrastructure > others alphabetically.

### 1b: Tech Stack Detection

Read manifest files at the project root (and workspace package roots for monorepos):

| File | Extract |
|------|---------|
| `package.json` | `name`, `description`, `dependencies`, `devDependencies`, `workspaces` |
| `go.mod` | Module path, Go version |
| `Cargo.toml` | Package name, dependencies |
| `pyproject.toml` | Project name, dependencies |

From dependencies, detect frameworks (Express, Fastify, React, Next.js, etc.), databases (Prisma, TypeORM, etc.), testing (Vitest, Jest, pytest, etc.), and build tools (Turbo, Nx, etc.).

### 1c: TODO/FIXME Scan

Grep all source files for actionable comments:

```
Grep(pattern: "TODO|FIXME|HACK|XXX", output_mode: "content", head_limit: 20)
```

Collect each match with file path and line number. Filter out bare markers (lines where `TODO` or `FIXME` is the only content with no descriptive text). Keep entries that have meaningful text after the marker.

### 1d: Architecture Gap Detection

Check for the existence of these paths. Missing = gap.

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

From the scan, derive:
- **Project name**: from `package.json` `name` field, `go.mod` module, or directory name
- **Project key**: uppercase, max 6 chars, derived from name (e.g., "kanon" -> "KAN", "my-cool-app" -> "MCA"). Must match `^[A-Z][A-Z0-9]*$`
- **Description**: from README first line or `package.json` description, or "No description found"

---

## Phase 2: Resolve Project

Ensure the Kanon project exists without creating duplicates.

### 2a: Workspace Selection

- **Batch mode** (`workspaceId` provided): Use the provided `workspaceId`. No prompts.
- **Interactive mode** (`workspaceId` not provided):
  - Call `kanon_list_workspaces()`.
  - If exactly one workspace: auto-select it, inform the user.
  - If multiple: present a numbered list and ask the user to choose.
  - If none: stop and tell the user to create a workspace first.

### 2b: Project Lookup

Call `kanon_list_projects(workspaceId)`.

- **If a project with the derived key already exists**: Reuse it. Log:
  > "Project **{KEY}** already exists. Reusing it for seeding."
- **If no match**: Create the project:
  ```
  kanon_create_project(
    workspaceId: "{workspaceId}",
    key: "{KEY}",
    name: "{projectName}",
    description: "{description}"
  )
  ```

Store the `projectKey` for Phase 3.

---

## Phase 3: Seed Content

Create issues and roadmap items based on discovery results. This phase runs as a batch with no user prompts in batch mode.

### 3a: Idempotency Check

Call these once and cache the results:

```
kanon_list_issues(projectKey: "{KEY}")
kanon_list_roadmap(projectKey: "{KEY}")
```

Use these to skip items whose title matches an existing issue or roadmap item. Match logic: existing title starts with the same `[Area]` prefix AND contains the same key noun.

### 3b: Interactive Confirmation (interactive mode only)

In interactive mode, before creating anything, present a confirmation table:

```
## Proposed Items

| # | Type | Title | Group |
|---|------|-------|-------|
| 1 | issue | [API] Fix N+1 query in user list | api |
| 2 | issue | [Infra] Set up GitHub Actions | infra |
| ... | | | |
| 11 | roadmap | Add test infrastructure | — |

Create all {N} items? (y/n)
```

Wait for user confirmation. If declined, skip creation entirely.

In **batch mode**, skip this step — create everything silently.

### 3c: Issue Creation

Create issues in priority order, respecting a **total cap of 10 issues**:

1. **FIXME bugs** (up to 3): Type `bug`, priority `high`
2. **Architecture gaps** (up to 4): Type `task`, priority `medium`
3. **TODO tasks** (up to 3): Type `task`, priority `medium`

If fewer items exist in a category, overflow the budget to the next category.

#### Issue Templates

**TODO/FIXME issue:**
```
kanon_create_issue(
  projectKey: "{KEY}",
  title: "[{Area}] {Cleaned TODO/FIXME text}",
  type: "task" | "bug",           // task for TODO, bug for FIXME
  priority: "medium" | "high",    // medium for TODO, high for FIXME
  description: "Found at `{file}:{line}`\n\n> {original line}\n\nExtracted from codebase scan.",
  groupKey: "{area-groupKey}"
)
```

**Architecture gap issue:**
```
kanon_create_issue(
  projectKey: "{KEY}",
  title: "[{Area}] Set up {missing thing}",
  type: "task",
  priority: "medium",
  description: "The project is missing {thing}. This impacts {reason}.",
  groupKey: "{area-groupKey}"       // typically "infra" for CI/Docker/linting gaps
)
```

**Starter issue (based on tech stack):**
```
kanon_create_issue(
  projectKey: "{KEY}",
  title: "[{Area}] {Common setup task}",
  type: "task",
  priority: "low",
  description: "Detected {framework/tool} in the stack. This is a common setup improvement.",
  groupKey: "{area-groupKey}"
)
```

#### Title Format

Always use: `[Area] Verb phrase`

Good: `[API] Add request validation middleware`, `[Infra] Set up GitHub Actions CI`
Bad: `TODO fix auth`, `packages/api needs work`

### 3d: Roadmap Item Creation

Create roadmap items for larger concerns detected during discovery. **Cap at 5 items.** Only create for gaps actually detected. Status: `idea` for all.

| Gap detected | Roadmap title | Horizon | Effort | Impact |
|---|---|---|---|---|
| No CI/CD pipeline | Add CI/CD pipeline | `now` | 3 | 5 |
| No test configuration | Set up test infrastructure | `now` | 2 | 4 |
| No docs/ directory | Add project documentation | `next` | 2 | 3 |
| No Dockerfile | Add containerization | `next` | 2 | 3 |
| No linting config | Set up linting and formatting | `later` | 1 | 2 |

```
kanon_create_roadmap_item(
  projectKey: "{KEY}",
  title: "{roadmap title}",
  horizon: "now" | "next" | "later",
  effort: {1-5},
  impact: {1-5},
  description: "{why this matters}",
  status: "idea"
)
```

Skip any roadmap item whose title matches an existing roadmap item (idempotency).

### 3e: MCP Call Sequence

Execute in this order:

1. `kanon_list_issues(projectKey)` — cache for dedup
2. `kanon_list_roadmap(projectKey)` — cache for dedup
3. For each issue (in priority order): `kanon_create_issue(...)` — skip duplicates
4. For each roadmap item: `kanon_create_roadmap_item(...)` — skip duplicates

If any individual MCP call fails, log a warning and continue with the remaining items. Do not abort the entire flow.

---

## Phase 4: Report

Present results and persist context.

### 4a: Summary Table

```
## Kanon Init Summary

| Category | Count | Details |
|----------|-------|---------|
| Project | 1 | {KEY} ({created | reused}) |
| Groups | {N} | {group1}, {group2}, ... |
| Issues created | {N} | {X} bugs, {Y} tasks |
| Issues skipped (duplicates) | {N} | — |
| Roadmap items created | {N} | — |
| Roadmap items skipped | {N} | — |
```

### 4b: Save to Engram

```
mem_save(
  title: "Kanon project onboarded: {KEY}",
  type: "architecture",
  project: "{engram-project-name or KEY lowercase}",
  topic_key: "kanon-project/{KEY}",
  content: "
    **What**: Created/reused Kanon project {KEY} ({name}) in workspace {workspace-name}
    **Tech stack**: {detected stack summary}
    **Monorepo**: {yes/no}
    **Groups**: {group list}
    **Workspace ID**: {workspaceId}
    **Project key**: {KEY}
    **Issues created**: {N} ({breakdown by type})
    **Roadmap items created**: {N}
  "
)
```

---

## Edge Cases

**No recognizable project files found**: Derive minimal metadata from the directory name. Still allow project creation and seeding of architecture-gap issues.

**Key exceeds 6 characters**: Truncate intelligently. Prefer acronyms (e.g., "my-cool-app" -> "MCA") over simple truncation. Validate key matches `^[A-Z][A-Z0-9]*$`.

**Project key already exists**: Detected via `kanon_list_projects`. Reuse the existing project — do not create duplicates.

**Very large codebase with many TODOs**: The 20-match grep cap and 10-issue creation cap prevent overwhelming the board. Prioritize FIXME entries and items with descriptive text.

**Re-run on already-onboarded project**: Idempotency check (Phase 3a) prevents duplicate issues. New TODOs added since last run will be created.

**No TODOs found**: Skip TODO-derived issues. Architecture-gap and starter issues are still created.

**MCP call failure during seeding**: Log a warning and continue with remaining items. Never block the entire flow for a single failed call.

---

## Best Practices

1. **Clean titles for seeded issues** — TODO comments are often terse. Expand them into proper `[Area] Description` titles a teammate can understand.
2. **Respect all caps** — 10 issues, 5 roadmap items, 5 groups. Quality over quantity.
3. **Save to engram** — The onboarding context is valuable for future sessions. Do not skip Phase 4b.
4. **Fail gracefully** — If any MCP call fails during seeding, log a warning and continue. Do not abort.
5. **Idempotency first** — Always check for existing items before creating. A second run should produce zero duplicates.
6. **One project per run** — For monorepos with multiple logical projects, suggest running once per sub-project.

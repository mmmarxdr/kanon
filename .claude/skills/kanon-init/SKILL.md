---
name: kanon-init
description: Automated project onboarding — scan a codebase, create a Kanon project, and seed initial issues from TODOs
version: 1.0.0
tags: [kanon, onboarding, project-setup, codebase-scan]
---

# Kanon Init — Automated Project Onboarding

Scan the current codebase, create a Kanon project, and optionally seed issues from TODO/FIXME comments. One command takes a repo from unknown to fully tracked.

---

## Trigger

`/kanon-init`

---

## Step 1: Connectivity Check

Verify that the Kanon MCP server is available before doing anything else.

1. First, load the Kanon MCP tools via ToolSearch. Call ToolSearch with:
   `select:mcp__kanon__kanon_list_workspaces,mcp__kanon__kanon_create_project,mcp__kanon__kanon_update_project,mcp__kanon__kanon_list_projects,mcp__kanon__kanon_get_project`
   If ToolSearch returns no results, the Kanon MCP server is not configured. Stop and tell the user:
   > "The Kanon MCP server is not configured in your Claude Code settings. Add the Kanon MCP server configuration and try again."
2. Call `kanon_list_workspaces()` with no arguments.
3. **If the call succeeds** — proceed to Step 2 with the returned workspaces.
4. **If the call fails** — stop and tell the user:
   > "The Kanon MCP server is not reachable. Make sure the Kanon API is running, the MCP server is configured in your Claude Code settings, and the `KANON_API_KEY` environment variable is set."

Do NOT proceed past this step if connectivity fails.

---

## Step 2: Workspace Selection

Use the workspaces returned from Step 1.

- **If exactly one workspace exists**: Present it to the user and auto-select it.
  > "Found workspace **{name}** (`{slug}`). I'll use this one. OK?"
- **If multiple workspaces exist**: Present a numbered list and ask the user to choose.
  > "Found {N} workspaces:
  > 1. {name1} (`{slug1}`)
  > 2. {name2} (`{slug2}`)
  >
  > Which workspace should this project be created in?"
- **If no workspaces exist**: Stop and tell the user:
  > "No workspaces found. Create a workspace first via the Kanon web UI or seed script, then re-run `/kanon-init`."

Store the selected `workspaceId` for later use.

---

## Step 3: Codebase Scan

Analyze the current working directory to understand the project. Gather the following:

### 3a: Package / Manifest Files

Look for these files at the project root (read each if it exists):

| File | Extract |
|------|---------|
| `package.json` | `name`, `description`, `scripts`, `dependencies`, `devDependencies`, `workspaces` |
| `go.mod` | Module path, Go version, key dependencies |
| `Cargo.toml` | Package name, version, dependencies |
| `pyproject.toml` | Project name, dependencies, build system |
| `pom.xml` | `groupId`, `artifactId`, dependencies |
| `build.gradle` / `build.gradle.kts` | Project name, plugins, dependencies |
| `mix.exs` | App name, deps |
| `Gemfile` | Key gems |
| `composer.json` | Name, require |

If a root `package.json` has a `workspaces` field, identify it as a monorepo and list the workspace packages.

### 3b: Directory Structure

List top-level directories and identify their purpose:

| Directory pattern | Likely purpose |
|-------------------|----------------|
| `src/`, `lib/`, `app/` | Application source code |
| `test/`, `tests/`, `__tests__/`, `spec/` | Test suites |
| `docs/`, `documentation/` | Documentation |
| `scripts/`, `tools/` | Build and utility scripts |
| `packages/`, `libs/`, `modules/` | Monorepo packages |
| `api/`, `server/` | Backend / API |
| `web/`, `client/`, `frontend/` | Frontend |
| `infra/`, `terraform/`, `k8s/`, `.github/` | Infrastructure / CI |
| `prisma/`, `migrations/`, `db/` | Database |

### 3c: Tech Stack Detection

Based on files found, identify:
- **Language(s)**: TypeScript, Go, Rust, Python, Java, etc.
- **Framework(s)**: Next.js, Express, Gin, Actix, Django, Spring, etc.
- **Database**: Prisma, TypeORM, GORM, SQLAlchemy, etc.
- **Testing**: Vitest, Jest, Go test, pytest, etc.
- **Build tools**: Turbo, Nx, Make, Gradle, etc.
- **Monorepo**: Yes/No (based on workspaces field or packages directory)

### 3d: README Content

If `README.md` exists, read the first 50 lines to extract the project's stated purpose and any setup instructions.

---

## Step 4: Present Findings

Show the user a summary of what was discovered:

```
## Codebase Scan Results

**Detected tech stack**: {language(s)}, {framework(s)}, {database}, {test framework}
**Monorepo**: {Yes — N packages / No}
**Key directories**: {list of top-level dirs and purposes}

**Suggested project name**: {derived from package.json name, go.mod module, or directory name}
**Suggested project key**: {uppercase, max 6 chars, derived from name — e.g. "kanon" -> "KAN", "my-cool-app" -> "MYCOOL" or "MCA"}

**Description**: {from README first line or package.json description, or "No description found"}
```

---

## Step 5: User Confirmation

Ask the user to confirm or modify the project details before creating:

> "Here is what I'll create:
>
>   **Project name**: {name}
>   **Project key**: {key}
>   **Workspace**: {workspace name}
>   **Description**: {description}
>
> Want me to proceed? You can change the name, key, or description first."

Wait for user confirmation. If the user provides changes, update accordingly.

Before confirming, check for key conflicts:
1. Call `kanon_list_projects(workspaceId: "{workspaceId}")`.
2. If any existing project has the same key, inform the user and suggest an alternative.

---

## Step 6: Project Creation

Once the user confirms:

1. Call `kanon_create_project` with the confirmed details:
   ```
   kanon_create_project(
     workspaceId: "{workspaceId}",
     key: "{KEY}",
     name: "{name}",
     description: "{description}"
   )
   ```

2. Report the created project key and ID to the user.

3. If the user provided an engram project name, set it on the project:
   ```
   kanon_update_project(
     projectKey: "{KEY}",
     engramNamespace: "{engram-project-name}"
   )
   ```

---

## Step 7: Optional TODO/FIXME Issue Seeding

After project creation, offer to scan for TODO and FIXME comments:

> "Want me to scan the codebase for TODO/FIXME comments and create issues from them?"

If the user agrees:

1. Use the Grep tool to search for `TODO|FIXME` patterns across the codebase:
   ```
   Grep pattern: "TODO|FIXME" with output_mode: "content"
   ```

2. **Cap at 20 results.** If more than 20 are found, pick the most informative ones (those with descriptive text after the TODO/FIXME marker).

3. Present the findings as a numbered list:
   ```
   Found {N} TODO/FIXME comments (showing top 20):

   1. `src/api/auth.ts:42` — TODO: Add rate limiting to this endpoint
   2. `src/db/queries.ts:108` — FIXME: N+1 query here, needs optimization
   3. ...

   Which ones should I create as issues? (enter numbers, "all", or "none")
   ```

4. Wait for user selection. For each selected item:
   - Derive a clean title following `[Area] Imperative description` format
   - Set type to `task` (for TODOs) or `bug` (for FIXMEs)
   - Set priority to `medium` (default) or `high` (for FIXMEs)
   - Include the file path and line number in the description
   - Call `kanon_create_issue` for each

5. Report all created issue keys when done.

If the user declines, skip this step entirely.

---

## Step 8: Save to Engram

After successful project creation, save the onboarding context to engram for future sessions:

```
mem_save(
  title: "Kanon project onboarded: {KEY}",
  type: "architecture",
  project: "{engram-project-name or KEY lowercase}",
  topic_key: "kanon-project/{KEY}",
  content: "
    **What**: Created Kanon project {KEY} ({name}) in workspace {workspace-name}
    **Tech stack**: {detected stack summary}
    **Monorepo**: {yes/no}
    **Key directories**: {dir summary}
    **Workspace ID**: {workspaceId}
    **Project key**: {KEY}
    **Issues seeded**: {N issues created from TODOs, or 'none'}
  "
)
```

This allows future agent sessions to recover project context without re-scanning.

---

## Edge Cases

**No recognizable project files found**: Present minimal findings. Ask the user to provide the project name and key manually. Still allow project creation — not every project has standard manifest files.

**Key exceeds 6 characters**: Truncate intelligently. Prefer acronyms (e.g., "my-cool-app" -> "MCA") over simple truncation. Always validate the key matches `^[A-Z][A-Z0-9]*$`.

**Project key already exists**: Detect via `kanon_list_projects` and suggest alternatives by appending a digit (e.g., "KAN" -> "KAN2") or using a different abbreviation.

**Very large codebase with many TODOs**: The 20-item cap prevents overwhelming the user. Prioritize TODOs with descriptive text over bare `// TODO` markers.

**User wants to re-run on an already-onboarded project**: Check `kanon_list_projects` first. If the project key already exists, inform the user and ask if they want to update the existing project instead of creating a new one.

---

## Best Practices

1. **Always confirm before creating** — Never create the project without explicit user approval on the key, name, and workspace.
2. **Clean titles for seeded issues** — TODO comments are often terse. Expand them into proper `[Area] Description` titles a teammate can understand.
3. **Respect the cap** — Never create more than 20 issues from a TODO scan. Quality over quantity.
4. **Save to engram** — The onboarding context is valuable for future sessions. Do not skip Step 8.
5. **Fail gracefully** — If any MCP call fails during issue seeding, log a warning and continue with the remaining items. Do not abort the entire flow.
6. **One project per run** — This skill creates one project per invocation. For monorepos with multiple logical projects, suggest running `/kanon-init` once per sub-project.

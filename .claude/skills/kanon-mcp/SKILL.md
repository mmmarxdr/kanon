---
name: kanon-mcp
description: Human-facing project board integration — clean cards, meaningful titles, progressive enrichment from SDD and general work
version: 2.0.0
tags: [kanon, project-management, sdd, issue-tracking]
---

# Kanon MCP — Usage Guide

Kanon is the **human-facing project board**. Every card should be readable by a person who has never touched the codebase. Engram holds the technical memory; Kanon holds the work narrative.

---

## Core Philosophy

| Layer | Purpose | Audience |
|-------|---------|----------|
| **Kanon** | Track units of work with clean titles, rich descriptions, and meaningful states | Humans (developers, leads, stakeholders) |
| **Engram** | Store SDD artifacts, technical decisions, and codebase knowledge | Agents across sessions |
| **The agent** | Bridge both — create clean Kanon cards, enrich them with engram context | Both |

**One issue = one unit of work.** SDD phases do NOT create separate issues. They transition the same issue through states and progressively enrich its description.

---

## Available Tools

### Project and Group Discovery

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `kanon_list_projects(workspaceId)` | List all projects in a workspace | `workspaceId` (required) |
| `kanon_get_project(projectKey)` | Get full project details | `projectKey` (required) |
| `kanon_list_groups(projectKey)` | List issue groups (epics, sprints, etc.) | `projectKey` (required) |

### Issue Management

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `kanon_list_issues(projectKey, ...)` | List issues with optional filters | `projectKey` (required); filters: `state`, `type`, `priority`, `label`, `groupKey`, `assigneeId`, `sprintId` |
| `kanon_get_issue(issueKey)` | Get full issue details | `issueKey` (required, e.g. `"KAN-42"`) |
| `kanon_create_issue(projectKey, title, ...)` | Create a new issue | `projectKey`, `title` (required); optional: `type`, `priority`, `description`, `labels`, `groupKey`, `parentId`, `assigneeId`, `sprintId`, `dueDate` |
| `kanon_update_issue(issueKey, ...)` | Update issue fields | `issueKey` (required); optional: `title`, `description`, `priority`, `labels`, `assigneeId`, `sprintId`, `dueDate` |

### State Transitions

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `kanon_transition_issue(issueKey, state)` | Transition a single issue | `issueKey`, `state` (required) |
| `kanon_batch_transition(projectKey, groupKey, state)` | Transition all issues in a group | `projectKey`, `groupKey`, `state` (required) |

---

## Issue States

`backlog` | `explore` | `propose` | `design` | `spec` | `tasks` | `apply` | `verify` | `archived`

States reflect where the work currently stands — not which SDD phase generated an artifact.

## Issue Types and Priorities

**Types**: `feature`, `bug`, `task`, `spike`

**Priorities**: `critical`, `high`, `medium`, `low` — assign meaningfully, not everything is `medium`.

---

## Human-Readable Issue Titles

Titles follow the pattern: `[Area] Clear action description`

The area tag groups related work visually on the board.

**Good titles:**
- `[Bridge] Sync engine connection pooling`
- `[Auth] JWT token refresh race condition`
- `[UI] Dark mode toggle in settings`
- `[API] Rate limiting for public endpoints`

**Bad titles (never do this):**
- `sdd/sync-engine/proposal`
- `sdd-new/kanon-bridge/spec`
- `apply dark-mode`
- `Implement feature`

When creating an issue, derive the area from the feature domain and write the action in plain language a teammate would understand.

---

## Progressive Description Enrichment

As work progresses, the issue description builds up incrementally. Each phase appends its section. A human opening the card sees the full story without needing engram access.

### Target Description Structure

```markdown
## Context
[Why this work exists — added during explore/propose phase]

## Approach
[Technical approach chosen — added during design phase]

## Spec Summary
[Key requirements, acceptance criteria, edge cases — added during spec phase]

## Tasks
- [x] Task 1 — completed
- [ ] Task 2 — in progress
- [ ] Task 3 — pending
[Added during tasks phase, checkboxes updated during apply]

## Verification
[Test results, compliance status — added during verify phase]

## Engram References
- `sdd/{change}/proposal` — Full proposal details
- `sdd/{change}/spec` — Complete specification
- `sdd/{change}/design` — Architecture decisions
[Each phase appends its topic_key here as a breadcrumb trail]
```

### Phase-Specific Enrichment Rules

| Phase Completing | Section to Add/Update | Content Source |
|------------------|-----------------------|----------------|
| explore | **Context** | Investigation findings, problem statement |
| propose | **Context** (update) | Proposal intent, scope, constraints |
| design | **Approach** | Architecture decisions, tradeoffs, diagrams |
| spec | **Spec Summary** | Key requirements, acceptance criteria, scenarios |
| tasks | **Tasks** | Checklist of work items with descriptions |
| apply | **Tasks** (update) | Check off completed items, note deviations |
| verify | **Verification** | Test results, compliance, remaining concerns |
| archive | All sections | Final polish, ensure completeness |

Every phase also appends its engram `topic_key` to the **Engram References** section.

---

## Proactive Issue Creation

Create Kanon issues whenever the agent:

- **Starts meaningful work** — not just SDD, any substantial task the user requests
- **Discovers a bug** worth tracking during implementation
- **Identifies technical debt** that should not be forgotten
- **Finds follow-up items** during code review or verification

Before creating, call `kanon_list_issues` to check for duplicates or related existing cards.

Before creating an issue, call `kanon_list_groups(projectKey)` to discover available groups. If the issue's domain or area matches an existing group, assign it via `groupKey`.

### Labels for Categorization

Use labels to make the board scannable:

| Label | When to use |
|-------|-------------|
| `sdd` | Work driven by SDD workflow |
| `bug` | Bugs found during any work |
| `tech-debt` | Identified technical debt for later |
| `exploration` | Spikes, investigations, research |

Use groups for epics or feature areas when the project has them.

---

## SDD Integration

### Orchestrator Protocol

#### On `/sdd-new {change}`

1. Create ONE Kanon issue with a clean human-readable title:
   ```
   kanon_create_issue(
     projectKey: "{projectKey}",
     title: "[{Area}] {Human-readable description}",
     type: "{mapped-type}",
     description: "## Context\n{Initial change description}",
     labels: ["sdd"],
     groupKey: "{groupKey}"  // from kanon_list_groups — match area to group
   )
   ```
2. If the title is ambiguous, ask the user: "What should this card be called on the board?"
3. Store the returned `issueKey` for ALL subsequent phases.
4. Set initial state to `explore` or `propose` depending on which phase runs first.

#### On each SDD phase launch

Pass the issue key and project key to the sub-agent:
```
KANON: Project `{projectKey}`, issue `{issueKey}`.
  - Transition to `{phase_state}` at phase start.
  - After completing work, update the issue description to append your phase's findings.
  - Append your engram topic_key to the "Engram References" section.
```

#### Type Mapping

| SDD Change Type | Kanon Issue Type |
|-----------------|------------------|
| feature | `feature` |
| bugfix | `bug` |
| refactor | `task` |
| investigation | `spike` |

### Sub-Agent Responsibilities

Sub-agents that receive `kanon_issue_key` and `kanon_project_key`:

1. **FIRST action** — Transition the issue:
   ```
   kanon_transition_issue(issueKey: "{kanon_issue_key}", state: "{phase_state}")
   ```
2. **Do their phase work** — explore, design, spec, etc.
3. **LAST action before return** — Update the issue description:
   - Call `kanon_get_issue` to read the current description.
   - Append the relevant section (see Phase-Specific Enrichment Rules above).
   - Append the engram topic_key to "Engram References".
   - Call `kanon_update_issue` with the updated description.
4. **If any Kanon call fails** — Log a warning and continue. Never block work due to a Kanon error.
5. **Return envelope** — Include `kanon_issue_key` under `artifacts`.

---

## Non-SDD Usage

Kanon is not only for SDD. Use it as a general work tracker:

- **Track bugs found during work** — Create a card with type `bug`, label `bug`, clear title, and reproduction steps in the description.
- **Create follow-up cards** — When implementation reveals additional work, create a new issue linked via description reference.
- **Update existing issues** — When doing work related to an existing card, update its description with progress or findings.
- **Check for related work** — Before creating a new issue, call `kanon_list_issues` with relevant filters to avoid duplicates.
- **Close completed work** — Transition to `archived` when done, with a final description update summarizing the outcome.

---

## Best Practices

1. **Titles are for humans** — Write every title as if a teammate will scan it on a board. No internal identifiers, no SDD jargon.
2. **Descriptions tell the story** — A person opening the card should understand what, why, how, and current status without any other tool.
3. **One card, one unit of work** — Resist the urge to create cards for SDD phases. The phases are workflow steps, not work items.
4. **Get before update** — Always call `kanon_get_issue` before `kanon_update_issue` to read current state and avoid overwriting content.
5. **Use filters when listing** — Always use the most specific filters available. Avoid listing all issues unfiltered.
6. **Issue keys are stable** — Store and pass `issueKey` (e.g. `KAN-42`) as the canonical reference. Do not rely on titles.
7. **Batch transitions** — Use `kanon_batch_transition` when moving all issues in a group to the same state.
8. **Engram references are breadcrumbs** — Always include them so a future agent (or curious human) can dive deeper.
9. **Always check available groups** — Call `kanon_list_groups(projectKey)` before creating an issue. Ungrouped issues are harder to find on the board.

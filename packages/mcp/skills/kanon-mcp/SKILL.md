---
name: kanon-mcp
description: Human-facing project board integration — clean cards, meaningful titles, progressive enrichment from SDD and general work
version: 2.0.0
tags: [kanon, project-management, sdd, issue-tracking]
allowed-tools:
  - kanon_*
  - mem_save
  - mem_search
  - mem_get_observation
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

## Issue Lifecycle

1. **Pick issue**: `kanon_list_issues` — find assigned/available work
2. **Start work**: `kanon_start_work(key)` — auto-assigns, warns about conflicts
3. **Progress**: `kanon_transition_issue(key, "in_progress")`
4. **Update**: `kanon_update_issue(key, {description/context})` as you work
5. **Complete**: `kanon_transition_issue(key, "done")`
6. **Release**: `kanon_stop_work(key)` — frees ownership

ALWAYS call `start_work` before implementing. ALWAYS call `stop_work` when done.
Check `activeWorkers` in issue responses for conflict awareness.

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

**Bad titles (never do this):**
- `sdd/sync-engine/proposal`
- `apply dark-mode`
- `Implement feature`

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
[Added during tasks phase, checkboxes updated during apply]

## Verification
[Test results, compliance status — added during verify phase]

## Engram References
- `sdd/{change}/proposal` — Full proposal details
- `sdd/{change}/spec` — Complete specification
[Each phase appends its topic_key here as a breadcrumb trail]
```

### Phase-Specific Enrichment Rules

| Phase Completing | Section to Add/Update | Content Source |
|------------------|-----------------------|----------------|
| explore | **Context** | Investigation findings, problem statement |
| propose | **Context** (update) | Proposal intent, scope, constraints |
| design | **Approach** | Architecture decisions, tradeoffs |
| spec | **Spec Summary** | Key requirements, acceptance criteria |
| tasks | **Tasks** | Checklist of work items |
| apply | **Tasks** (update) | Check off completed items, note deviations |
| verify | **Verification** | Test results, compliance |
| archive | All sections | Final polish, ensure completeness |

Every phase also appends its engram `topic_key` to the **Engram References** section.

---

## Proactive Issue Creation

Create Kanon issues whenever the agent:

- **Starts meaningful work** — not just SDD, any substantial task
- **Discovers a bug** worth tracking during implementation
- **Identifies technical debt** that should not be forgotten
- **Finds follow-up items** during code review or verification

Before creating, call `kanon_list_issues` to check for duplicates.
Before creating, call `kanon_list_groups(projectKey)` to discover available groups and assign `groupKey`.

### Labels for Categorization

| Label | When to use |
|-------|-------------|
| `sdd` | Work driven by SDD workflow |
| `bug` | Bugs found during any work |
| `tech-debt` | Identified technical debt |
| `exploration` | Spikes, investigations, research |

---

## Non-SDD Usage

Kanon is not only for SDD. Use it as a general work tracker:

- **Track bugs found during work** — Create a card with type `bug`, clear title, and reproduction steps.
- **Create follow-up cards** — When implementation reveals additional work, create a new issue.
- **Update existing issues** — When doing related work, update the description with progress.
- **Close completed work** — Transition to `archived` when done, with a final description update.

---

## Best Practices

1. **Titles are for humans** — Write every title as if a teammate will scan it on a board.
2. **Descriptions tell the story** — A person opening the card should understand what, why, how, and current status.
3. **One card, one unit of work** — Do not create cards for SDD phases. Phases are workflow steps, not work items.
4. **Get before update** — Always call `kanon_get_issue` before `kanon_update_issue` to avoid overwriting content.
5. **Use filters when listing** — Always use the most specific filters available.
6. **Issue keys are stable** — Store and pass `issueKey` (e.g. `KAN-42`) as the canonical reference.
7. **Batch transitions** — Use `kanon_batch_transition` when moving all issues in a group to the same state.
8. **Engram references are breadcrumbs** — Always include them so a future agent can dive deeper.
9. **Always check available groups** — Call `kanon_list_groups(projectKey)` before creating an issue.

---
name: kanon-agent
description: Project board PM assistant — create issues, manage cycles, capture roadmap items, SDD hooks.
trigger: list issues, create issue, update issue, close issue, board management, start cycle, close sprint, roadmap item, track this, log a bug, deferred work
---

## Core Philosophy

One issue = one unit of work. Every card must be readable by a teammate who never touched the code.
Human-readable titles, not internal paths. Kanon is the narrative layer; engram is the memory layer.

## Issue Lifecycle

1. kanon_list_groups(projectKey) → pick groupKey
2. kanon_create_issue with [Area] title + group + description
3. kanon_start_work(issueKey)
4. kanon_transition_issue: backlog → todo → in_progress → review → done
5. kanon_update_issue: enrich description as work evolves
6. Deferred/later work → kanon_create_roadmap_item, NOT backlog
7. kanon_stop_work when done

## Title Format

Pattern: `[Area] Imperative verb phrase`
- Good: `[Auth] Fix OAuth redirect` | `[API] Add rate limiting`
- Bad: `fix thing` | `sdd/change/path` | `KAN-42`

Always call kanon_list_groups before creating an issue — assign a real groupKey.

## On-Demand Sections

| Trigger | Load section |
|---------|-------------|
| NL→field mapping, existence checks, create flow | sections/issue-creation.md |
| Roadmap horizons, deferred capture, promote-to-issue | sections/roadmap.md |
| Cycle lifecycle, scope changes, close dispositions | sections/cycle.md |
| SDD orchestrator hooks, deferred_items, ROADMAP injection | sections/sdd-hooks.md |

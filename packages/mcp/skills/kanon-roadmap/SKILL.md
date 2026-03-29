---
name: kanon-roadmap
description: Proactive roadmap capture — recognize future work during conversations, create and enrich roadmap items automatically
version: 2.0.0
tags: [kanon, roadmap, planning, proactive-capture]
---

# Kanon Roadmap — Proactive Capture Guide

Kanon's roadmap is where **future work lives before it becomes actionable**. Roadmap items track ideas, planned features, and improvements organized by time horizon. The agent's job is to capture these items proactively -- without waiting to be asked.

---

## Core Concepts

**Roadmap is not a backlog.** It is a planning tool organized by time horizons. Items move from vague ideas (someday) toward concrete plans (now), and when ready, get promoted to actionable issues.

---

## Project Resolution

Infer the project name from the current working directory. Resolve the project key by calling `kanon_list_projects(workspaceId)` and matching against project names. Cache the resolved key for the session.

---

## Horizons

| Horizon | Meaning |
|---------|---------|
| **now** | Ready to promote -- team could start this soon |
| **next** | Planned for the near future -- needs a bit more definition |
| **later** | Valuable but not urgent -- will revisit when priorities shift |
| **someday** | Ideas, wishes, long-term dreams -- no commitment |

Default: `later`

## Status

| Status | Meaning |
|--------|---------|
| **idea** | Not yet evaluated or committed to (default) |
| **planned** | Committed to -- decision made but not started |
| **in_progress** | Actively being worked on |
| **done** | Completed -- kept for historical reference |

## Effort and Impact (1-5 scale)

| Score | Effort | Impact |
|-------|--------|--------|
| 1 | Trivial -- an hour or less | Marginal improvement |
| 3 | Medium -- a few days | Meaningful improvement |
| 5 | Massive -- multi-week effort | Transformative |

---

## Available Tools

| Tool | Purpose |
|------|---------|
| `kanon_list_roadmap(projectKey, ...)` | List roadmap items with optional filters |
| `kanon_create_roadmap_item(projectKey, title, ...)` | Create a new roadmap item |
| `kanon_update_roadmap_item(projectKey, itemId, ...)` | Update a roadmap item |
| `kanon_delete_roadmap_item(projectKey, itemId)` | Permanently delete a roadmap item |
| `kanon_promote_roadmap_item(projectKey, itemId, ...)` | Promote a roadmap item to an actionable issue |
| `kanon_add_dependency(projectKey, sourceItemId, targetItemId, ...)` | Add a blocks relationship |
| `kanon_remove_dependency(projectKey, sourceItemId, dependencyId)` | Remove a dependency |

---

## Proactive Capture Triggers

### Trigger 1: Problem Capture During Conversations

When the user discusses a problem or improvement that is not being addressed now:
- "We should eventually...", "It would be nice if...", "Let's deal with that later..."

Action: Acknowledge, ask for confirmation, create with appropriate horizon.

### Trigger 2: Out-of-Scope Work During Planning

When exploration or proposals identify deferred or out-of-scope work, capture it as roadmap items with `horizon: later` or `someday`.

### Trigger 3: Progressive Enrichment

When new information is learned about an existing roadmap item, update it with `kanon_update_roadmap_item`.

---

## Roadmap Item vs Issue

| Signal | Create a... |
|--------|-------------|
| "We should do X someday" | **Roadmap item** |
| "This would be nice eventually" | **Roadmap item** |
| "Let's fix this now" / "This is blocking" | **Issue** |
| Bug found during implementation | **Issue** |
| Roadmap item reaches `now` and team is ready | **Promote** the item |

Rule of thumb: If someone could start working on it tomorrow with clear understanding, it is an issue. If it needs more thought or is deferred, it is a roadmap item.

---

## Promotion

Use `kanon_promote_roadmap_item` when:
- Item's horizon has reached `now`
- User explicitly says "let's do this"
- A dependency was resolved that makes the item actionable

---

## Title Format

`[Area] Clear action description`

Good: `[API] Rate limiting for public endpoints`, `[Infra] Migrate from Heroku to Fly.io`
Bad: `Rate limiting` (no area), `TODO: maybe add dark mode?` (not clear)

---

## Best Practices

1. Confirm before creating -- always ask the user.
2. Titles are for humans -- scannable on a planning board.
3. Check for duplicates -- call `kanon_list_roadmap` before creating.
4. Start vague, refine over time -- items in `someday` can be minimal.
5. Do not over-capture -- only capture things the user agrees are worth tracking.
6. Promote at the right time -- do not promote `later` or `someday` items unless user asks.

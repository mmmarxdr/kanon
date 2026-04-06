---
name: kanon-roadmap
description: Proactive roadmap capture — recognize future work during conversations and SDD workflows, create and enrich roadmap items automatically
version: 2.0.0
tags: [kanon, roadmap, planning, proactive-capture]
allowed-tools:
  - kanon_*
  - mem_save
  - mem_search
  - mem_get_observation
---

# Kanon Roadmap — Proactive Capture Guide

Kanon's roadmap is where **future work lives before it becomes actionable**. Roadmap items track ideas, planned features, and improvements organized by time horizon. The agent's job is to capture these items proactively — without waiting to be asked.

---

## Core Philosophy

| Layer | Purpose | Audience |
|-------|---------|----------|
| **Roadmap items** | Track future work that is not yet actionable | Humans |
| **Issues** | Track actionable work currently in progress or ready to start | Humans |
| **Engram** | Store technical memory, SDD artifacts, decisions | Agents |
| **The agent** | Bridge all three — capture future work to roadmap, promote to issues when ready | Both |

**Roadmap is not a backlog.** It is a planning tool organized by time horizons. Items move from vague ideas (someday) toward concrete plans (now), and when ready, get promoted to actionable issues.

---

## Project Resolution (mandatory)

The user should never need to know or type a project key. The agent infers it internally.

1. Infer the project name from `cwd` basename (e.g., `/home/user/workspace/micro-claw` -> `micro-claw`).
2. Resolve the project key via `kanon_list_projects(workspaceId)` — match name case-insensitively.
3. If no match: tell the user and suggest `/kanon-init`.
4. If multiple matches: present options and let the user choose.
5. Cache the resolved `projectKey` for the session.

Always refer to the project by its human-readable name, never by its key.

---

## Horizons

| Horizon | Meaning | Typical items |
|---------|---------|---------------|
| **now** | Ready to promote — team could start soon | Well-understood, clear scope |
| **next** | Planned for near future — needs more definition | Known value, some open questions |
| **later** | Valuable but not urgent — will revisit | Good ideas that need time to mature |
| **someday** | Ideas, wishes, long-term dreams | Brainstorms, speculative concepts |

**Default horizon**: `later`. Items naturally move left as they gain clarity and urgency.

---

## Status

| Status | Meaning |
|--------|---------|
| **idea** | Default. Not yet evaluated or committed to |
| **planned** | Committed to — decision made, but not started |
| **in_progress** | Actively being worked on |
| **done** | Completed — kept for historical reference |

**Horizon vs Status**: Horizon = when (timeline). Status = what state (lifecycle). An item can be `horizon: now, status: planned`.

---

## Effort and Impact Scoring

Both use a 1-5 integer scale. Optional but help prioritize.

| Score | Effort | Impact |
|-------|--------|--------|
| 1 | Trivial — an hour or less | Marginal improvement |
| 2 | Small — a day or less | Nice to have |
| 3 | Medium — a few days | Meaningful improvement |
| 4 | Large — a week or more | Significant value |
| 5 | Massive — multi-week | Transformative |

**High impact + low effort** items are strong candidates for `now` or `next`.

---

## Roadmap Item vs Issue — When to Use Which

| Signal | Create a... |
|--------|-------------|
| "We should do X someday" | **Roadmap item** |
| "This would be nice eventually" | **Roadmap item** |
| SDD explore/propose identifies out-of-scope work | **Roadmap item** |
| "Let's fix this now" / "This is blocking" | **Issue** |
| Bug found during implementation | **Issue** |
| Roadmap item reaches `now` and team is ready | **Promote** the roadmap item |

**Rule of thumb**: If someone could start working on it tomorrow with clear scope, it is an issue. If it needs more thought or is deferred, it is a roadmap item.

---

## Proactive Capture Triggers

These are situations where the agent MUST consider creating or updating a roadmap item **without being explicitly asked**. Always confirm with the user before creating.

### Trigger 1: Problem Capture During Conversations

**When**: The user discusses a problem or improvement opportunity not being addressed now.

**Signals**: "We should eventually...", "It would be nice if...", "Let's deal with that later", "Down the road we could...", user describes friction or workarounds.

**Action**: Acknowledge -> confirm -> create with appropriate horizon. Save item ID to engram with `topic_key: kanon/roadmap/{item-slug}`.

### Trigger 2: SDD Exploration and Proposal Capture

**When**: During SDD workflows, the orchestrator identifies deferred or out-of-scope items.

**This is the orchestrator's responsibility** — not the sub-agent's. The orchestrator reviews deferred items after phases complete.

**Action**: Extract deferred items from the executive summary, present to user, create confirmed items with horizon `later` (intentionally deferred) or `someday` (vague). Reference the SDD change name in the description.

**Injection block for sub-agents**:
```
ROADMAP: When you identify out-of-scope or deferred work, list it under "Deferred Items"
  in your executive_summary. Include: title, reason deferred, suggested horizon (later/someday).
  The orchestrator handles roadmap capture — do NOT create roadmap items yourself.
```

### Trigger 3: Progressive Enrichment

**When**: The agent learns new information about an existing roadmap item across sessions or during related work.

**Signals**: Working on something related, user mentions updated priorities, new technical context changes estimates, a dependency is resolved.

**Action**: Search engram for the item ID (`mem_search` with `kanon/roadmap/{slug}`), then update via `kanon_update_roadmap_item` with only the changed fields. Append to description, do not overwrite.

---

## Dependencies

Dependencies express **blocks** relationships between roadmap items. Use `kanon_add_dependency` to create them.

- Use sparingly — only for real sequencing constraints, not topical similarity.
- The API enforces cycle prevention. Do not retry on cycle errors; resolve the modeling issue.
- To remove, you need the `dependencyId` (the dependency record's UUID, not the target item's ID).

---

## Deletion

Use `kanon_delete_roadmap_item` to permanently remove an item. Irreversible.

**Appropriate**: Duplicate created in error, idea explicitly rejected, item merged into another.
**Not appropriate**: Completed (use `status: "done"`), deprioritized (use `horizon: "someday"`), promoted (already marked automatically).

---

## Promotion — When and How

Promotion converts a roadmap item into an actionable Kanon issue. The roadmap item is marked as `promoted`.

**When**: Item reaches `now`, team says "let's do this", an SDD workflow starts for it, or a blocking dependency is resolved.

Use `kanon_promote_roadmap_item` — optionally override title, type, priority, and groupKey. The new issue inherits the roadmap item's description. Multiple issues can be promoted from a single roadmap item.

---

## Cross-Skill Coordination

| Responsibility | Handled by |
|----------------|------------|
| Issue creation and enrichment during SDD | Sub-agents (per kanon-mcp) |
| Roadmap deferred-item capture after SDD phases | Orchestrator (Trigger 2) |
| Issue state transitions per SDD phase | Sub-agents |
| Roadmap item lifecycle updates | Orchestrator or agent responding to user signals |
| Saving roadmap item IDs to engram | Whoever creates the item — immediately |

Do NOT ask sub-agents to create roadmap items for out-of-scope work. That is the orchestrator's job.

---

## Human-Readable Titles

Follow the same pattern as Kanon issues: `[Area] Clear action description`

**Good**: `[API] Rate limiting for public endpoints`, `[UI] Dark mode support across all pages`
**Bad**: `Rate limiting` (too vague), `sdd/auth/future-work-1` (internal jargon)

---

## Labels for Categorization

| Label | When to use |
|-------|-------------|
| `performance` | Speed, caching, optimization |
| `security` | Auth, encryption, access control |
| `ux` | User experience improvements |
| `dx` | Developer experience, tooling |
| `infra` | Infrastructure, deployment |
| `tech-debt` | Known shortcuts to revisit |
| `integration` | Third-party services, APIs |

Use domain-specific labels alongside category labels for cross-referencing.

---

## Best Practices

1. **Confirm before creating** — Always ask the user before adding a roadmap item.
2. **Titles are for humans** — Write every title as if a stakeholder will scan it.
3. **Descriptions tell the story** — Include why it matters, what problem it solves, known constraints.
4. **Start vague, refine over time** — Items in `someday` can be minimal. Enrich as they move toward `now`.
5. **Check for duplicates** — Call `kanon_list_roadmap` before creating.
6. **Link to context** — Reference the SDD change name when surfaced by SDD work.
7. **Save IDs to engram** — After creating, save `itemId` with `topic_key: kanon/roadmap/{slug}`.
8. **Effort and impact are living estimates** — Update as understanding grows.
9. **Promote at the right time** — Do not promote `later`/`someday` items unless user explicitly asks.

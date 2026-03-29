---
name: kanon-roadmap
description: Proactive roadmap capture — recognize future work during conversations and SDD workflows, create and enrich roadmap items automatically
version: 2.0.0
tags: [kanon, roadmap, planning, proactive-capture]
---

# Kanon Roadmap — Proactive Capture Guide

Kanon's roadmap is where **future work lives before it becomes actionable**. Roadmap items track ideas, planned features, and improvements organized by time horizon. The agent's job is to capture these items proactively — without waiting to be asked.

---

## Core Philosophy

| Layer | Purpose | Audience |
|-------|---------|----------|
| **Roadmap items** | Track future work that is not yet actionable | Humans (developers, leads, stakeholders) |
| **Issues** | Track actionable work currently in progress or ready to start | Humans |
| **Engram** | Store technical memory, SDD artifacts, decisions | Agents across sessions |
| **The agent** | Bridge all three — capture future work to roadmap, promote to issues when ready, link to engram for technical depth | Both |

**Roadmap is not a backlog.** It is a planning tool organized by time horizons. Items move from vague ideas (someday) toward concrete plans (now), and when ready, get promoted to actionable issues.

---

## Project Resolution (mandatory)

The user should never need to know or type a project key (e.g. `"MCLAW"`). The agent infers the project and resolves the key internally.

### How to resolve the project

1. **Infer the project name from the current working directory.** Use the basename of `cwd` (e.g. `/home/user/workspace/micro-claw` → `micro-claw`). The user is always inside the project directory when they run roadmap commands.
2. **Resolve the project key** by calling `kanon_list_projects(workspaceId)` and matching the inferred name against the `name` field of returned projects (case-insensitive, normalize hyphens/underscores/spaces). If there is exactly one match, use its `key` as the `projectKey` for all subsequent tool calls.
3. **If no match is found**: Tell the user — "I couldn't find a Kanon project matching '{inferred-name}'. You can create one with `/kanon-init` or tell me the project name to use."
4. **If multiple matches are found**: Present the options using human-readable names and let the user choose.
5. **Cache the resolved `projectKey`** for the rest of the session. Do not re-resolve on every call.

### User-facing communication

- Always refer to the project by its human-readable name (e.g. "micro-claw"), never by its key (e.g. "MCLAW").
- The project key is an internal implementation detail passed to tool calls only.
- In examples below, `projectKey` parameters show placeholder values like `"PROJ"` — the agent resolves the real key at runtime using the steps above.

---

## Available Tools

### Roadmap Management

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `kanon_list_roadmap(projectKey, ...)` | List roadmap items with optional filters | `projectKey` (required); filters: `horizon`, `status`, `label` |
| `kanon_create_roadmap_item(projectKey, title, ...)` | Create a new roadmap item | `projectKey`, `title` (required); optional: `description`, `horizon`, `status`, `effort`, `impact`, `labels`, `targetDate` |
| `kanon_update_roadmap_item(projectKey, itemId, ...)` | Update a roadmap item | `projectKey`, `itemId` (required); optional: `title`, `description`, `horizon`, `status`, `effort`, `impact`, `labels`, `targetDate`, `sortOrder` |
| `kanon_delete_roadmap_item(projectKey, itemId)` | Permanently delete a roadmap item | `projectKey`, `itemId` (required) |
| `kanon_promote_roadmap_item(projectKey, itemId, ...)` | Promote a roadmap item to an actionable issue | `projectKey`, `itemId` (required); optional: `title`, `type`, `priority`, `labels`, `groupKey` |

### Dependency Management

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `kanon_add_dependency(projectKey, sourceItemId, targetItemId, ...)` | Add a blocks relationship between two roadmap items | `projectKey`, `sourceItemId`, `targetItemId` (required); optional: `type` (only `"blocks"` supported) |
| `kanon_remove_dependency(projectKey, sourceItemId, dependencyId)` | Remove a dependency | `projectKey`, `sourceItemId`, `dependencyId` (required — the dependency's own UUID, not the target item's ID) |

**Parameter note**: All tools that reference a roadmap item use `itemId` (UUID), NOT `id`. This is the exact parameter name the MCP tools expect.

---

## Horizons

Horizon answers **when** — where this item sits in the planning timeline.

| Horizon | Meaning | Typical items |
|---------|---------|---------------|
| **now** | Ready to promote — team could start this soon | Well-understood items with clear scope |
| **next** | Planned for the near future — needs a bit more definition | Items with known value but some open questions |
| **later** | Valuable but not urgent — will revisit when priorities shift | Good ideas that need time to mature |
| **someday** | Ideas, wishes, long-term dreams — no commitment | Brainstorms, exploratory concepts, "wouldn't it be nice" |

**Default horizon**: `later` — the API default. Use `someday` for truly vague or speculative ideas. Items naturally move left as they gain clarity and urgency.

---

## Status

Status answers **what state** the item is in — independent of horizon.

| Status | Meaning |
|--------|---------|
| **idea** | Default. Not yet evaluated or committed to |
| **planned** | Committed to — decision made to do this work, but not started |
| **in_progress** | Actively being worked on (usually means it has been promoted or is underway) |
| **done** | Completed — kept for historical reference |

**Horizon vs Status**: Horizon = when (timeline placement). Status = what state (lifecycle). An item can be `horizon: now, status: planned` (ready timeline, decision made but not started) or `horizon: later, status: idea` (future, still exploratory).

---

## Effort and Impact Scoring

Both use a 1-5 integer scale. These are optional but help prioritize.

| Score | Effort (how much work) | Impact (how much value) |
|-------|----------------------|------------------------|
| 1 | Trivial — an hour or less | Marginal improvement |
| 2 | Small — a day or less | Nice to have |
| 3 | Medium — a few days | Meaningful improvement |
| 4 | Large — a week or more | Significant value |
| 5 | Massive — multi-week effort | Transformative |

**High impact + low effort** items are strong candidates for moving to `now` or `next`.

---

## Target Date

Use `targetDate` (ISO 8601, e.g. `"2026-06-01"`) when an item has a known external deadline or milestone dependency. This is optional and distinct from horizon — a `later` item can still have a target date (e.g., "before Q3 review").

---

## Roadmap Item vs Issue — When to Use Which

| Signal | Create a... | Why |
|--------|-------------|-----|
| "We should do X someday" | **Roadmap item** | Future work, not ready to act on |
| "This would be nice to have eventually" | **Roadmap item** | Idea worth capturing, no urgency |
| SDD explore/propose identifies out-of-scope work | **Roadmap item** | Related future work surfaced during planning |
| "Let's fix this now" / "This is blocking" | **Issue** | Actionable work, ready to start |
| Bug found during implementation | **Issue** | Needs attention, has concrete reproduction steps |
| Roadmap item reaches `now` and team is ready | **Promote** the roadmap item | Graduates from planning to execution |

**Rule of thumb**: If someone could start working on it tomorrow with a clear understanding of what to do, it is an issue. If it needs more thought, scoping, or is explicitly deferred, it is a roadmap item.

---

## Proactive Capture Triggers

These are situations where the agent MUST consider creating or updating a roadmap item **without being explicitly asked**. Always confirm with the user before creating.

### Trigger 1: Problem Capture During Conversations

**When**: The user discusses a problem, limitation, or improvement opportunity that is not being addressed right now.

**Detection signals**:
- "We should eventually..."
- "It would be nice if..."
- "That's a problem but not urgent"
- "Let's deal with that later"
- "Down the road we could..."
- User describes friction, workarounds, or manual processes
- User mentions a feature they wish existed

**Action**:
1. Acknowledge the idea: "That sounds like a good candidate for the roadmap."
2. Ask for confirmation: "Want me to add it as a roadmap item?"
3. If yes, create with appropriate horizon:
   - User says "not urgent" / "eventually" / "someday" -> `someday` or `later`
   - User says "soon" / "next sprint" / "after this" -> `next`
   - User says "ready to go" / "we should start soon" -> `now`
4. Use a clear, human-readable title (same `[Area] Description` pattern as issues).

**Example**:
```
User (cwd: /home/user/workspace/micro-claw):
  "The API doesn't have rate limiting. It hasn't been a problem yet but we should add it before we go public."

Agent (internally resolves micro-claw -> projectKey "MCLAW" via kanon_list_projects):
  "That sounds like a good roadmap item for micro-claw — rate limiting before public launch. Want me to add it?"

User: "Yeah, go ahead."

-> kanon_create_roadmap_item(
     projectKey: "MCLAW",   // resolved internally, never shown to user
     title: "[API] Add rate limiting for public endpoints",
     description: "No rate limiting currently. Need to add before public launch to prevent abuse. Consider per-endpoint limits and API key tiers.",
     horizon: "next",
     impact: 4,
     labels: ["api", "security"]
   )
```

After creating, save the item ID to engram for cross-session lookup:
```
mem_save(
  title: "Roadmap item: [API] Add rate limiting",
  type: "discovery",
  topic_key: "kanon/roadmap/api-rate-limiting",
  content: "itemId: {returned-uuid}\nTitle: [API] Add rate limiting for public endpoints\nHorizon: next"
)
```

### Trigger 2: SDD Exploration and Proposal Capture

**When**: During SDD workflows (explore, propose), the orchestrator identifies features, improvements, or related work that is explicitly marked as "out of scope", "future work", "deferred", or "not included in this change".

**This is the orchestrator's responsibility** — not the sub-agent's. The orchestrator reviews deferred items after `sdd-explore` and `sdd-propose` phases complete, then handles roadmap capture directly.

**Detection signals**:
- Proposal says "out of scope: X, Y, Z"
- Exploration surfaces related problems not covered by the current change
- Design document mentions "future enhancement"
- Spec excludes scenarios with "deferred to future work"

**Action**:
1. After the SDD phase returns, extract the list of deferred/out-of-scope items from the executive summary.
2. Present the list to the user: "The proposal identified these items as out of scope. Want me to add any to the roadmap?"
3. For each confirmed item:
   - Check for duplicates first: `kanon_list_roadmap(projectKey, ...)` with relevant filters.
   - If no existing item, create one:
     - Horizon: `later` (known value, intentionally deferred) or `someday` (vague, needs more thought)
     - Status: `idea` (not yet committed)
     - Description: Reference the SDD change name that surfaced it
     - Labels: Include the SDD change area for traceability
   - If an existing item covers this, update it with the new context.
4. Save each created item's ID to engram (see Trigger 1 pattern above).

**Injection block for sub-agents** — include this in SDD phase prompts so sub-agents surface deferred items clearly:
```
ROADMAP: When you identify out-of-scope or deferred work in your output, list it explicitly
  under a "Deferred Items" heading in your executive_summary. Include: item title, why it was
  deferred, and suggested horizon (later/someday). The orchestrator will handle roadmap capture.
```

**Example**:
```
SDD proposal for "auth-redesign" returns with deferred items:
  "Out of scope: SSO integration, API key management, audit logging"

Orchestrator presents to user:
  "The auth-redesign proposal deferred 3 items. Add any to roadmap?
   1. SSO integration for enterprise users
   2. API key management
   3. Audit logging"

User: "Add 1 and 3."

-> kanon_create_roadmap_item(
     projectKey: "{resolved-key}",   // resolved internally from cwd project name
     title: "[Auth] SSO integration for enterprise users",
     description: "Identified during auth-redesign (sdd/auth-redesign/proposal). Deferred from current scope. Would need SAML/OIDC provider support.",
     horizon: "later",
     impact: 4,
     effort: 4,
     labels: ["auth", "enterprise"]
   )

-> kanon_create_roadmap_item(
     projectKey: "{resolved-key}",   // resolved internally from cwd project name
     title: "[Auth] Audit logging for auth events",
     description: "Identified during auth-redesign (sdd/auth-redesign/proposal). Deferred from current scope.",
     horizon: "later",
     impact: 3,
     effort: 2,
     labels: ["auth", "security"]
   )
```

### Trigger 3: Progressive Enrichment

**When**: The agent learns new information about an existing roadmap item across sessions or during related work.

**Detection signals**:
- Working on something related to an existing roadmap item
- User mentions updated priorities or timelines
- New technical context changes the effort/impact estimate
- A dependency is resolved that unblocks a roadmap item
- User says "actually that X thing is more urgent now"

**Action**:
1. Search for the existing item — first check engram (`mem_search` with `kanon/roadmap/{slug}`), then fall back to `kanon_list_roadmap(projectKey, ...)`.
2. Update the relevant fields:
   - New context learned -> update `description` (append, do not overwrite)
   - Priority changed -> update `horizon` (e.g., `later` -> `next`) and/or `status`
   - Better understanding of scope -> update `effort` and/or `impact`
   - Known deadline identified -> set `targetDate`
   - Related work completed -> note it in `description`
3. Use `kanon_update_roadmap_item` with only the changed fields.

**Cross-session lookup pattern**: When creating a roadmap item, always save its ID to engram so future agents can find it without scanning the full roadmap:
```
mem_save(
  title: "Roadmap item ID: {slugified-title}",
  type: "discovery",
  scope: "project",
  topic_key: "kanon/roadmap/{item-slug}",
  content: "itemId: {uuid}\nTitle: {title}\nProjectKey: {projectKey}\nHorizon: {horizon}"
)
```
On future sessions, do `mem_search(query: "kanon/roadmap/{slug}")` → `mem_get_observation(id)` → use the stored `itemId` directly.

**Example**:
```
Agent is working on database optimization. Finds that the "full-text search" roadmap item
would benefit from the new indexes being added.

First, look up the item ID from engram:
  mem_search(query: "kanon/roadmap/full-text-search") -> get itemId

-> kanon_update_roadmap_item(
     projectKey: "{resolved-key}",   // resolved internally from cwd project name
     itemId: "{item-uuid}",
     description: "{existing description}\n\n---\nUpdate 2026-03-24: Database optimization work added indexes that would support this. Effort estimate reduced.",
     effort: 2  // was 4, now easier because of new indexes
   )
```

---

## Dependencies

Dependencies express **blocks** relationships between roadmap items. Item A blocks item B means B cannot start until A is complete.

### When to Use Dependencies

- One item requires infrastructure or foundation work from another (e.g., "API versioning" blocks "Deprecate v1 endpoints")
- A feature depends on a prerequisite feature being in place
- You want to make sequencing visible on the roadmap

### How Dependencies Work

```
kanon_add_dependency(
  projectKey: "{resolved-key}",
  sourceItemId: "{blocker-item-uuid}",   // the item that must complete first
  targetItemId: "{blocked-item-uuid}",   // the item waiting on the blocker
  type: "blocks"                          // only "blocks" is currently supported
)
```

The API enforces **cycle prevention** — if adding the dependency would create a circular chain, it returns an error. Do not retry; resolve the modeling issue instead.

To remove a dependency, you need the `dependencyId` (the dependency record's own UUID, returned when the dependency was created), not the target item's ID:

```
kanon_remove_dependency(
  projectKey: "{resolved-key}",
  sourceItemId: "{blocker-item-uuid}",
  dependencyId: "{dependency-record-uuid}"
)
```

### Dependency Guidance

- Use sparingly — only when the dependency is a real sequencing constraint, not just topical similarity.
- If two items are related but either could proceed independently, use labels or description references instead.
- Before adding a dependency, confirm both items exist and their IDs are correct.

---

## Deletion

Use `kanon_delete_roadmap_item` to permanently remove an item. This is irreversible.

**When deletion is appropriate**:
- Duplicate item created in error
- Idea explicitly rejected and no historical value in keeping it
- Item was merged into another item (update the surviving item's description first to capture any unique context from the deleted one)

**When NOT to delete**:
- Item was completed — use `status: "done"` and keep it for history
- Item was deprioritized — use `horizon: "someday"` or `status: "idea"`
- Item was promoted to an issue — it is automatically marked `promoted: true`, leave it

```
kanon_delete_roadmap_item(
  projectKey: "{resolved-key}",
  itemId: "{item-uuid}"
)
```

---

## Promotion — When and How

Promotion converts a roadmap item into an actionable Kanon issue. The roadmap item is marked as `promoted` and linked to the new issue via a back-reference.

### When to Promote

- The item's horizon has reached `now`
- The team/user explicitly says "let's do this"
- An SDD workflow is about to start for this item
- A dependency was resolved that makes the item actionable

### How to Promote

```
kanon_promote_roadmap_item(
  projectKey: "{resolved-key}",
  itemId: "{roadmap-item-uuid}",
  title: "[Area] Clear action title",   // optional — defaults to roadmap item title
  type: "feature",                       // optional — defaults based on content
  priority: "medium",                    // optional
  groupKey: "sprint-4"                   // optional — assign to a sprint/group
)
```

**After promotion**: The new issue is created with the roadmap item's description as initial context. The roadmap item gets `promoted: true` and retains its history. Multiple issues can be promoted from a single roadmap item (e.g., a large feature broken into phases).

---

## Cross-Skill Coordination

When both `kanon-mcp` and `kanon-roadmap` skills are active in the same session, responsibilities are split:

| Responsibility | Handled by |
|----------------|------------|
| Issue creation and enrichment during SDD phases | Sub-agents (per kanon-mcp KANON: block) |
| Roadmap deferred-item capture after sdd-explore / sdd-propose | Orchestrator (per kanon-roadmap Trigger 2) |
| Issue state transitions per SDD phase | Sub-agents |
| Roadmap item lifecycle (horizon/status updates) | Orchestrator or agent responding to user signals |
| Saving roadmap item IDs to engram | Whoever creates the item — immediately after creation |

**Do not** ask sub-agents to create roadmap items for out-of-scope work. That is the orchestrator's job, done with user confirmation after the phase returns.

---

## Human-Readable Titles

Follow the same pattern as Kanon issues: `[Area] Clear action description`

**Good titles**:
- `[API] Rate limiting for public endpoints`
- `[UI] Dark mode support across all pages`
- `[Infra] Migrate from Heroku to Fly.io`
- `[DX] Automated database seeding for local dev`

**Bad titles (never do this)**:
- `Rate limiting` (too vague, no area)
- `TODO: maybe add dark mode?` (not a clear description)
- `sdd/auth/future-work-1` (internal jargon)
- `Feature request from user` (meaningless on a board)

---

## Labels for Categorization

Use labels to make the roadmap scannable and filterable:

| Label | When to use |
|-------|-------------|
| `performance` | Speed, caching, optimization work |
| `security` | Auth, encryption, access control |
| `ux` | User experience improvements |
| `dx` | Developer experience, tooling, workflows |
| `infra` | Infrastructure, deployment, monitoring |
| `tech-debt` | Known shortcuts that need revisiting |
| `integration` | Third-party services, APIs, plugins |

Use domain-specific labels (e.g., `auth`, `api`, `billing`) alongside category labels for cross-referencing.

---

## Best Practices

1. **Confirm before creating** — Always ask the user before adding a roadmap item. A quick "Want me to add that to the roadmap?" is enough.
2. **Titles are for humans** — Write every title as if a stakeholder will scan it on a planning board.
3. **Descriptions tell the story** — Include why it matters, what problem it solves, and any known constraints. A person reading the card should understand the item without additional context.
4. **Start vague, refine over time** — Items in `someday` can have minimal descriptions. As they move toward `now`, enrich them with scope, effort estimates, and acceptance criteria.
5. **Check for duplicates** — Before creating, call `kanon_list_roadmap` to see if a similar item already exists. Update the existing item rather than creating a duplicate.
6. **Link to context** — When a roadmap item is surfaced by SDD work, reference the change name in the description so future agents can trace the connection.
7. **Do not over-capture** — Not every passing thought needs a roadmap item. Capture things the user explicitly agrees are worth tracking, or things identified as deferred scope in SDD.
8. **Save IDs to engram** — After creating any roadmap item, save its `itemId` to engram with `topic_key: kanon/roadmap/{slug}`. This is the only reliable way to find it across sessions.
9. **Effort and impact are living estimates** — Update them as understanding grows. Initial estimates are guesses; that is fine.
10. **Promote at the right time** — Do not promote items in `later` or `someday` unless the user explicitly asks. Promotion means "ready to work on."
11. **One roadmap item can spawn multiple issues** — Large features may be promoted in phases. Each promotion creates a separate issue linked back to the same roadmap item.

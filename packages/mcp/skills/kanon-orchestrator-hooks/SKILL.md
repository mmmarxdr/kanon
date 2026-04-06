---
name: kanon-orchestrator-hooks
description: Kanon-specific hooks for the SDD orchestrator — ROADMAP injection into sub-agent prompts and post-phase deferred_items processing
version: 1.0.0
tags: [kanon, sdd, orchestrator, roadmap]
allowed-tools:
  - kanon_*
  - mem_save
  - mem_search
  - mem_get_observation
---

# Kanon Orchestrator Hooks

This skill is loaded by the orchestrator when launching SDD phases or processing phase results in the kanon project. It provides kanon-specific behavior that extends the generic SDD workflow.

## Hook 1: SessionStart — Project Detection

When a session starts in a kanon-managed project:

1. Infer project from `cwd` basename, resolve via `kanon_list_projects`.
2. Call `kanon_list_issues(projectKey, state: "apply")` to find active work.
3. If active issues exist, show the user: "Active issues: KAN-42 [Auth] Fix OAuth redirect (apply)".
4. Cache the `projectKey` for the session.

## Hook 2: ROADMAP Injection for Sub-Agent Launches

When launching phases `sdd-explore`, `sdd-propose`, `sdd-design`, or `sdd-spec`, include this block in the sub-agent prompt:

```
ROADMAP: When you identify out-of-scope or deferred work, list it in your return envelope
  under `deferred_items`. Format: title ([Area] Description), reason, suggested_horizon (later/someday).
  The orchestrator handles roadmap capture — do NOT create roadmap items yourself.
```

## Hook 3: Post-Phase Roadmap Processing

After receiving results from `sdd-explore`, `sdd-propose`, `sdd-design`, or `sdd-spec`:

1. Check if `deferred_items` is present and non-empty in the return envelope.
2. If yes, present to user: "This phase identified {N} items as out of scope. Add any to the roadmap?"
3. For each confirmed item: check duplicates via `kanon_list_roadmap`, create via `kanon_create_roadmap_item`, save to engram.

## Hook 4: Roadmap Capture During Conversation

Detect these signals during any conversation in the kanon project:
- "We should eventually...", "down the road", "someday", "not now but later"
- User describes friction, workarounds, or missing features they defer

Action: Acknowledge -> confirm -> create roadmap item if user agrees.

## Hook 5: PreCompact — Save Session State

Before context compaction, save the current work session state:

1. For each active issue (from SessionStart cache), call `kanon_update_issue` to append current progress to the description.
2. Call `mem_session_summary` to persist session context to engram.
3. This ensures no work-in-progress context is lost during compaction.

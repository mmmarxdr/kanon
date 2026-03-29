---
name: kanon-orchestrator-hooks
description: Kanon-specific hooks for the SDD orchestrator — ROADMAP injection into sub-agent prompts and post-phase deferred_items processing
version: 1.0.0
tags: [kanon, sdd, orchestrator, roadmap]
---

# Kanon Orchestrator Hooks

This skill is loaded by the orchestrator when launching SDD phases or processing phase results in the kanon project. It provides kanon-specific behavior that extends the generic SDD workflow.

## Hook 1: ROADMAP Injection for Sub-Agent Launches

When launching phases `sdd-explore`, `sdd-propose`, `sdd-design`, or `sdd-spec`, include this block in the sub-agent prompt:

```
ROADMAP: When you identify out-of-scope or deferred work, list it in your return envelope
  under `deferred_items`. Format: title ([Area] Description), reason, suggested_horizon (later/someday).
  The orchestrator handles roadmap capture — do NOT create roadmap items yourself.
```

## Hook 2: Post-Phase Roadmap Processing

After receiving results from `sdd-explore`, `sdd-propose`, `sdd-design`, or `sdd-spec`:

1. Check if `deferred_items` is present and non-empty in the return envelope.
2. If yes, present to user: "This phase identified {N} items as out of scope. Add any to the roadmap?"
3. For each confirmed item: load `kanon-roadmap` skill and follow Trigger 2 procedure (duplicate check via `kanon_list_roadmap`, create via `kanon_create_roadmap_item`, save to engram).
4. If `kanon-roadmap` skill is not loaded, load it from `.claude/skills/kanon-roadmap/SKILL.md`.

## Hook 3: Roadmap Capture During Conversation

Detect these signals during any conversation in the kanon project:
- "We should eventually...", "down the road", "someday", "not now but later"
- User describes friction, workarounds, or missing features they defer
- Out-of-scope items identified during any analysis

Action:
1. Acknowledge: "That sounds like a roadmap item for kanon."
2. Confirm: "Want me to add it?"
3. If yes: load `kanon-roadmap` skill for full capture behavior.

Do NOT create roadmap items without user confirmation.

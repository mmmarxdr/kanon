---
name: roadmap
description: Roadmap horizons and deferred-work capture patterns for Kanon project management.
---

# Roadmap — Horizons and Deferred Capture

## Horizons Table

| Horizon | Meaning | Action |
|---------|---------|--------|
| now | Current cycle work | kanon_create_issue → attach to cycle |
| next | Planned for next 1–2 cycles | kanon_create_roadmap_item (horizon: next) |
| later | Out-of-scope, future idea | kanon_create_roadmap_item (horizon: later) |
| someday | Low-priority, no timeline | kanon_create_roadmap_item (horizon: someday) |

## Deferred Work Capture Patterns

Trigger words: "later", "someday", "eventually", "out of scope", "nice to have", "future".

When a user mentions deferred work during conversation or SDD phases:
1. Capture it immediately — do not wait until end of session
2. kanon_create_roadmap_item({ projectKey, title: "[Area] Verb phrase", horizon, description })
3. Reference the roadmap item in the current issue or SDD artifact

## Promote to Issue

When a roadmap item becomes actionable:
1. kanon_get_roadmap_item(itemId) → review description and context
2. kanon_promote_roadmap_item(itemId) → creates a linked issue
3. Enrich the new issue with current context before attaching to a cycle

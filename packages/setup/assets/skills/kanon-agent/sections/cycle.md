---
name: cycle
description: Cycle lifecycle, scope changes, and close dispositions for Kanon project management.
---

# Cycle — Lifecycle, Scope Changes, Close Dispositions

## Cycle Lifecycle

1. kanon_create_cycle({ projectKey, name, startDate, endDate })
2. kanon_update_cycle_scope({ cycleId, add: issueKeys, remove: [], reason }) — scope at start
3. During cycle: kanon_get_cycle(cycleId) for burnup/risks
4. Scope change: audit trail — add comment before attaching/detaching
5. kanon_close_cycle({ cycleId, disposition }) at end

## Scope Change Patterns

When the user wants to add or remove issues mid-cycle:
- Always ask WHY before modifying scope (unplanned work is a risk signal)
- kanon_get_issue(issueKey) first to confirm current state
- Document the reason as a comment on the issue before scope change

## Close Dispositions

| Disposition | Use when |
|-------------|----------|
| leave | Keep incomplete issues attached |
| move_to_next | Carry incomplete issues into the next upcoming cycle; requires projectKey |
| move_to_backlog | Detach incomplete issues back to backlog |

After closing: un-done issues → triage to next cycle or roadmap, not left dangling.

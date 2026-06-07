# Cycle — Lifecycle, Scope Changes, Close Dispositions

## Cycle Lifecycle

1. kanon_create_cycle({ projectKey, name, startDate, endDate })
2. kanon_attach_issues_to_cycle({ cycleId, issueKeys }) — scope at start
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
| completed | All scoped issues reached "done" state |
| partial | Some issues remain — carry forward or defer |
| cancelled | Cycle abandoned — issues should be re-triaged |

After closing: un-done issues → triage to next cycle or roadmap, not left dangling.

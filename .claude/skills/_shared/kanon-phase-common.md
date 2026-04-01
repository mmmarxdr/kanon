# Kanon Issue Tracking (Optional)

If there is **no** external orchestrator and you work from Cursor with a single agent, follow **`kanon-workflow`** (`packages/mcp/skills/kanon-workflow/SKILL.md`) for Kanon-first steps, SDD gates, and Engram — then apply the table below when you have `kanon_issue_key` / `kanon_project_key`.

If the orchestrator provides `kanon_issue_key` and `kanon_project_key` in your launch prompt, integrate with Kanon issue tracking. Kanon is the **human-facing project board** — every update you make should be readable by a person who has never touched the codebase.

## At Phase START (first action)

Transition the Kanon issue to the state matching your current phase:

```
kanon_transition_issue(issueKey: "{kanon_issue_key}", state: "{phase_state}")
```

## At Phase END (last action before return)

Update the issue description to append your phase's findings:

1. Call `kanon_get_issue(issueKey: "{kanon_issue_key}")` to read the current description.
2. Append the section matching your phase (see table below).
3. Append your engram `topic_key` to the **Engram References** section at the bottom.
4. Call `kanon_update_issue(issueKey: "{kanon_issue_key}", description: "{updated_description}")`.

## Phase-to-State and Enrichment Mapping

| Phase | Kanon State | Section to Add/Update | Content |
|-------|-------------|----------------------|---------|
| explore | `explore` | **Context** | Investigation findings, problem statement |
| propose | `propose` | **Context** (update) | Proposal intent, scope, constraints |
| design | `design` | **Approach** | Architecture decisions, tradeoffs |
| spec | `spec` | **Spec Summary** | Key requirements, acceptance criteria |
| tasks | `tasks` | **Tasks** | Checklist of work items |
| apply | `apply` | **Tasks** (update) | Check off completed items, note deviations |
| verify | `verify` | **Verification** | Test results, compliance status |
| archive | `archived` | All sections | Final polish, ensure completeness |

## Rules

- Call the transition as your **FIRST action**, before any other work.
- Update the description as your **LAST action**, before returning.
- If any Kanon call fails, **log a warning but continue** — never block the phase.
- Include `kanon_issue_key` in your return envelope under `artifacts`.
- If no `kanon_issue_key` was provided, skip all Kanon steps silently.
- Write descriptions in plain language — no SDD jargon, no engram topic keys in the main sections (only in the Engram References section at the bottom).

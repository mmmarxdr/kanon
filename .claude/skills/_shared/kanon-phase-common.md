# Kanon Issue Tracking (Optional)

If the orchestrator provides `kanon_issue_key` and `kanon_project_key` in your launch prompt, integrate with Kanon issue tracking. Kanon is the **human-facing project board** — every update you make should be readable by a person who has never touched the codebase.

> **Valid issue states**: `backlog`, `todo`, `in_progress`, `review`, `done`. SDD phase names are NOT issue states — `kanon_transition_issue` rejects them with an enum error. Use the mapping table below.

> **No kanon tools?** Most `sdd-*` sub-agents do not have `kanon_*` tools. If the tools are unavailable, skip every Kanon step and instead include the intended transition and description sections in your return envelope under `board_updates` — the orchestrator applies them.

## At Phase START (first action)

Transition the Kanon issue to the state mapped for your phase (skip if it is already in that state):

```
kanon_transition_issue(issueKey: "{kanon_issue_key}", state: "{mapped_state}")
```

## At Phase END (last action before return)

Update the issue description to append your phase's findings:

1. Call `kanon_get_issue(issueKey: "{kanon_issue_key}")` to read the current description.
2. Append the section matching your phase (see table below).
3. Append your engram `topic_key` to the **Engram References** section at the bottom.
4. Call `kanon_update_issue(issueKey: "{kanon_issue_key}", description: "{updated_description}")`.

## Phase-to-State and Enrichment Mapping

<!-- Audience: SDD sub-agents (apply/verify) — dev-only, NOT shipped -->
| Phase | Kanon State | Section to Add/Update | Content |
|-------|-------------|----------------------|---------|
| explore | `in_progress` | **Context** | Investigation findings, problem statement |
| propose | `in_progress` | **Context** (update) | Proposal intent, scope, constraints |
| design | `in_progress` | **Approach** | Architecture decisions, tradeoffs |
| spec | `in_progress` | **Spec Summary** | Key requirements, acceptance criteria |
| tasks | `in_progress` | **Tasks** | Checklist of work items |
| apply | `in_progress` | **Tasks** (update) | Check off completed items, note deviations |
| verify | `review` | **Verification** | Test results, compliance status |
| archive | `done` | All sections | Final polish, ensure completeness |

## Rules

- Call the transition as your **FIRST action**, before any other work.
- Update the description as your **LAST action**, before returning.
- If any Kanon call fails, **log a warning but continue** — never block the phase.
- Include `kanon_issue_key` in your return envelope under `artifacts`.
- If no `kanon_issue_key` was provided, skip all Kanon steps silently.
- Write descriptions in plain language — no SDD jargon, no engram topic keys in the main sections (only in the Engram References section at the bottom).

---
name: issue-creation
description: Detailed issue creation flow — natural-language field mapping, cheap existence checks, and confirmation patterns.
---

# Issue Creation — Detailed Flow

## PM-Facing Content

Write for PMs and teammates, not for the agent's local session. Keep durable problem, impact,
acceptance criteria, evidence, decisions, solution, risks, and verification. Never include absolute
local paths, worktrees, temporary branches, agent/model/session identifiers, memory internals,
harness mechanics, or command transcripts. A repository-relative design reference is acceptable
only when it materially helps the reader.

## NL → Field Mapping

| User says | Field |
|-----------|-------|
| "bug", "broken", "crash" | type: bug |
| "feature", "add", "support" | type: feature |
| "improve", "refactor", "clean" | type: task |
| "urgent", "blocking" | priority: critical |
| "next sprint" | cycleId: current cycle |
| "start now", "I'll work on it" | assigneeId: list_members.memberId; then start_work |
| "later", "someday", "eventually" | → roadmap, not backlog |

## Cheap existence checks

Before creating an issue, confirm the target exists — use cheap calls:

```
kanon_list_issues({ projectKey, groupKey?, limit: 3, format: compact })
```

- limit: 3 keeps response small; enough to confirm duplicates
- format: compact minimizes token cost for existence checks
- If a matching issue already exists, offer to update it instead of creating a duplicate

## Detailed Create Flow

1. Parse NL description → extract title, type, priority, groupKey
2. kanon_list_groups(projectKey) → confirm groupKey is valid
3. If work starts now → kanon_list_members; pass the selected memberId as assigneeId
4. kanon_create_issue({ projectKey, title: "[Area] Verb phrase", groupKey, description, type, priority, assigneeId? })
5. If cycleId known → kanon_update_cycle_scope({ cycleId, add: [issueKey], remove: [], reason })
6. Before active work, set dueDate from an explicit user/plan/cycle decision; ask if unknown
7. kanon_start_work sets a missing startDate to today; preserve an existing plan
8. Confirm with format: ack response

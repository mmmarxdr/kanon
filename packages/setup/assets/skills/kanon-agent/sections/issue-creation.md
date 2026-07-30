---
name: issue-creation
description: Detailed issue creation flow — natural-language field mapping, cheap existence checks, and confirmation patterns.
---

# Issue Creation — Detailed Flow

## NL → Field Mapping

| User says | Field |
|-----------|-------|
| "bug", "broken", "crash" | type: bug |
| "feature", "add", "support" | type: feature |
| "improve", "refactor", "clean" | type: task |
| "urgent", "blocking" | priority: critical |
| "next sprint" | cycleId: current cycle |
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
3. kanon_create_issue({ projectKey, title: "[Area] Verb phrase", groupKey, description, type, priority })
4. If cycleId known → kanon_attach_issues_to_cycle({ cycleId, add: [issueKey], remove: [], reason })
5. Confirm with format: ack response

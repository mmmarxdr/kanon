---
name: kanon-create-issue
description: Natural Language Issue Creation — parse user descriptions of bugs, features, and tasks into well-structured Kanon issues without manual field-filling
version: 1.0.0
tags: [kanon, issue-creation, natural-language, productivity]
---

# Kanon Create Issue — Natural Language Issue Creation

When a user describes a problem, feature, or task in natural language, this skill transforms that description into a well-structured Kanon issue -- no manual field-filling required. The agent infers type, priority, labels, and description structure from the user's words and confirms before creating.

---

## Core Philosophy

Zero friction. The user says "track this bug with the login redirect" and gets a properly structured issue on the board. **Always preview before creating.**

---

## Trigger Conditions

- Explicit: "Create an issue for...", "Add a ticket for...", "Track this as...", "Log a bug for..."
- Implicit: User describes a bug/problem and says "let's track this", "we should not forget this"
- Post-fix: Agent discovers follow-up work, edge cases, or documentation gaps after a fix

---

## NL to Structured Field Mapping

### Title
- Format: `[Area] Imperative verb phrase`
- Areas: `API`, `Auth`, `UI`, `DB`, `Infra`, `DX`, `Billing`, etc.

| User says | Title |
|-----------|-------|
| "there's a bug where the login page redirects to 404" | `[Auth] Fix login page redirect to 404` |
| "we need rate limiting on the public API" | `[API] Add rate limiting for public endpoints` |

### Type

| Signal words | Type |
|-------------|------|
| "bug", "broken", "not working", "error", "crash", "fix" | `bug` |
| "add", "build", "implement", "new feature", "support" | `feature` |
| "refactor", "clean up", "improve", "migrate", "simplify" | `task` |
| "investigate", "explore", "research", "figure out" | `spike` |

Default: `task`

### Priority

| Signal | Priority |
|--------|----------|
| "blocking", "production down", "urgent", "critical" | `critical` |
| "before release", "important", "customer-facing" | `high` |
| "should fix", "eventually fix", no strong signals | `medium` |
| "nice to have", "low priority", "someday", "minor" | `low` |

Default: `medium`

### Labels

Infer from domain and technology mentioned: `auth`, `api`, `db`, `ui`, `performance`, `security`, `infra`, `dx`, `tech-debt`, `testing`.

### Description

Generate structured markdown:

```markdown
## Context
{What the problem or need is}

## Acceptance Criteria
- {Condition 1}
- {Condition 2}

## Notes
{Technical context, reproduction steps, constraints}
```

For bugs, add a Reproduction Steps section. For spikes, use Questions to Answer + Deliverable format.

### Group

Call `kanon_list_groups(projectKey)` and match the issue's area against existing group names. If a match exists, include `groupKey`.

---

## Confirmation Pattern

Always show a preview card before creating:

```
Title:       [Auth] Fix login page redirect to 404
Type:        bug
Priority:    high
Labels:      auth, ui
Group:       Authentication
State:       backlog
```

If the user says "yes", call `kanon_create_issue`. If "edit", update and re-show. Report the created issue key (e.g., "Created KAN-47").

---

## Edge Cases

- **Project key unknown**: Call `kanon_list_projects` to find it.
- **Very short description**: Generate a minimal but valid description.
- **Roadmap item instead**: If user says "someday" or "eventually", suggest the roadmap instead.
- **Multiple issues implied**: Identify each and offer to create separately.

---

## Best Practices

1. Always preview first -- never create without confirmation.
2. Titles are for humans -- scannable on a board by someone not in this conversation.
3. Check for duplicates -- call `kanon_list_issues` before creation.
4. Report the issue key -- always echo the created key (e.g., "Created KAN-42").
5. Default to backlog -- let the user or workflow move issues forward.
6. Check groups before creating -- call `kanon_list_groups(projectKey)` and assign `groupKey` when a match exists.

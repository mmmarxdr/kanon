---
name: kanon-create-issue
description: Natural Language Issue Creation — parse user descriptions of bugs, features, and tasks into well-structured Kanon issues without manual field-filling
version: 1.0.0
tags: [kanon, issue-creation, natural-language, productivity]
allowed-tools:
  - kanon_*
  - mem_save
  - mem_search
  - mem_get_observation
---

# Kanon NL Create — Natural Language Issue Creation

When a user describes a problem, feature, or task in natural language, this skill transforms that description into a well-structured Kanon issue — no manual field-filling required. The agent infers type, priority, labels, and description structure from the user's words and confirms before creating.

---

## Core Philosophy

The goal is zero friction. The user should be able to say "track this bug with the login redirect" and get a properly structured issue on the board without answering a form. The agent does the work of translating intent into structure.

**Always preview before creating.** Show the inferred card to the user before calling `kanon_create_issue`. A brief confirmation step prevents unwanted noise on the board.

---

## Trigger Conditions

### Explicit creation requests
- "Create an issue for...", "Add a ticket for...", "Track this as...", "Log a bug for..."

### Implicit creation signals
- User describes a bug or problem and says "let's track this" or "we should not forget this"
- After a bug fix, the agent identifies follow-up work or remaining risk
- User describes something in terms of "we need to...", "we should..."

### Post-fix follow-up
After completing a bug fix or feature, if the agent discovers additional edge cases, deferred refactoring, or documentation gaps, suggest: "I also noticed [X]. Want me to create a follow-up issue?"

---

## NL to Structured Field Mapping

### Title

- **Format**: `[Area] Imperative verb phrase`
- **Area**: Infer from domain — `API`, `Auth`, `UI`, `DB`, `Infra`, `DX`, `Billing`, etc.

| User says | Title |
|-----------|-------|
| "there's a bug where the login page redirects to 404" | `[Auth] Fix login page redirect to 404` |
| "we need rate limiting on the public API" | `[API] Add rate limiting for public endpoints` |
| "refactor the user list to fix the N+1 query" | `[DB] Fix N+1 query in user list` |
| "investigate why deploys are slow" | `[Infra] Investigate slow deploy times` |

### Type

| Signal words / context | Type |
|------------------------|------|
| "bug", "broken", "not working", "error", "crash", "regression", "fix" | `bug` |
| "add", "build", "implement", "new feature", "support", "allow users to" | `feature` |
| "refactor", "clean up", "improve", "migrate", "rename", "simplify" | `task` |
| "investigate", "understand", "explore", "research", "figure out" | `spike` |

When ambiguous, default to `task`.

### Priority

| Signal | Priority |
|--------|----------|
| "blocking", "production down", "urgent", "critical", "right now" | `critical` |
| "before release", "important", "customer-facing", "high priority" | `high` |
| "should fix", "eventually", "not urgent but", no strong signals | `medium` |
| "nice to have", "low priority", "someday", "minor", "cosmetic" | `low` |

When no urgency signal is present, default to `medium`.

### Labels

| User mentions | Labels to add |
|---------------|---------------|
| Authentication, login, tokens, JWT | `auth` |
| API endpoints, REST, GraphQL | `api` |
| Database, queries, migrations | `db` |
| UI components, styling, layout | `ui` |
| Performance, speed, latency, caching | `performance` |
| Security vulnerabilities, XSS | `security` |
| Infrastructure, deployment, CI/CD | `infra` |
| Developer experience, tooling | `dx` |
| Technical debt, cleanup, refactor | `tech-debt` |
| Testing, coverage, flaky tests | `testing` |

Multiple labels are allowed and encouraged when multiple concerns are present.

### Description

Always generate a structured markdown description.

**Standard template**:
```markdown
## Context
{What the problem or need is}

## Acceptance Criteria
- {Condition 1 that must be true when done}
- {Condition 2}

## Notes
{Technical context, reproduction steps, constraints}
```

**Bug template** (when reproduction steps are available):
```markdown
## Context
{Bug description}

## Reproduction Steps
1. {Step 1}
2. Expected: {what should happen}
3. Actual: {what happens instead}

## Acceptance Criteria
- Bug no longer reproduces following the steps above

## Notes
{Additional context}
```

**Spike template**:
```markdown
## Context
{Why this investigation is needed}

## Questions to Answer
- {Question 1}
- {Question 2}

## Deliverable
{What the spike should produce — decision, document, prototype}
```

### Group

Before creating any issue, call `kanon_list_groups(projectKey)` to discover available groups. Match the issue's area against group names case-insensitively. If no match, omit `groupKey`.

### Default State

Always create with `state: backlog`. Do not transition unless the user explicitly says it is in progress.

---

## Confirmation Pattern

Before calling `kanon_create_issue`, always show a preview card:

```
Here is the issue I would create:

  Title:       [Auth] Fix login page redirect to 404
  Type:        bug
  Priority:    high
  Labels:      auth, ui
  Group:       Authentication
  State:       backlog

  Description:
  ## Context
  The login page redirects to a 404 error page after submitting credentials...

Create it? [yes / edit / cancel]
```

If the user says "edit", update and show again. If "yes", create and report the issue key.

---

## Worked Examples

### Example 1: Simple Bug Report

**User**: "There's a bug where logging in with Google OAuth redirects to a 404. Let's track it."

**Inferred**: Title `[Auth] Fix Google OAuth redirect to 404`, type `bug`, priority `medium`, label `auth`.

Agent calls `kanon_list_groups("KAN")`, finds `Authentication` group. Shows preview, user says "Yes, but make it high priority — it's blocking QA." Agent updates priority and creates.

**Result**: "Created KAN-47."

### Example 2: Vague Task Description

**User**: "Add a task to investigate why our CI builds are taking so long."

**Inferred**: Title `[Infra] Investigate slow CI build times`, type `spike`, priority `medium`, labels `infra`, `dx`.

Description uses questions-to-answer format with deliverable being a recommendation. Preview shown, user confirms.

**Result**: "Created KAN-50."

---

## Edge Cases

**Project key unknown**: Ask the user or call `kanon_list_projects` to find it. Do not guess.

**Very short description**: Generate a minimal but valid description. Better to create sparse than block on details.

**Conflicting signals** (e.g., "not urgent but critical"): Favor the strongest signal. If ambiguous, ask.

**Roadmap vs issue**: If user says "someday", "eventually", "down the road", suggest the roadmap instead: "This sounds more like a roadmap item — want me to add it there instead?"

**Multiple issues implied**: Identify each and offer to create separate issues.

---

## Duplicate Check

Before creating, call `kanon_list_issues(projectKey, ...)` with relevant filters. If a similar issue exists, surface it: "There is already KAN-35 '[Auth] OAuth callback configuration'. Same thing, or separate?"

---

## Best Practices

1. **Always preview first** — Never create without showing the structured card and getting confirmation.
2. **Titles are for humans** — Every title should be scannable on a board.
3. **Infer boldly, adjust gracefully** — Make confident inferences. Update immediately if corrected.
4. **Check for duplicates** — A quick filter before creation prevents board clutter.
5. **Report the issue key** — Always echo the created key (e.g., "Created KAN-42").
6. **Default to backlog** — Let the user or workflow move issues forward.
7. **Structured descriptions matter** — A person opening the card later should understand what to do.
8. **Roadmap vs issue** — If deferred, suggest the roadmap. Do not cram everything into the backlog.
9. **Check groups before creating** — Always call `kanon_list_groups(projectKey)` and assign `groupKey` when a match exists.

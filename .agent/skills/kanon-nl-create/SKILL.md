---
name: kanon-nl-create
description: Natural Language Issue Creation — parse user descriptions of bugs, features, and tasks into well-structured Kanon issues without manual field-filling
version: 1.0.0
tags: [kanon, issue-creation, natural-language, productivity]
---

# Kanon NL Create — Natural Language Issue Creation

When a user describes a problem, feature, or task in natural language, this skill transforms that description into a well-structured Kanon issue — no manual field-filling required. The agent infers type, priority, labels, and description structure from the user's words and confirms before creating.

---

## Core Philosophy

The goal is zero friction. The user should be able to say "track this bug with the login redirect" and get a properly structured issue on the board without answering a form. The agent does the work of translating intent into structure.

**Always preview before creating.** Show the inferred card to the user before calling `kanon_create_issue`. A brief confirmation step prevents unwanted noise on the board.

---

## Trigger Conditions

Activate this skill when any of the following signals are present:

### Explicit creation requests
- "Create an issue for..."
- "Add a ticket for..."
- "Open a card for..."
- "Track this as..."
- "Log a bug for..."
- "File this as a task..."
- "Can you create a Kanon issue for..."

### Implicit creation signals
- User describes a bug or problem and says "let's track this" or "we should not forget this"
- After a bug fix, the agent identifies follow-up work or remaining risk
- User describes something in terms of "we need to...", "we should...", or "someone needs to..."
- User narrates a task or feature while discussing related work

### Post-fix follow-up
After completing a bug fix or feature, if the agent discovers:
- Additional edge cases not addressed
- Refactoring needed but deferred
- Documentation gaps
- Related components that may have the same issue

The agent should say: "I also noticed [X] while working on this. Want me to create a follow-up issue?"

---

## NL → Structured Field Mapping

### Title

- **Format**: `[Area] Imperative verb phrase`
- **Imperative form**: Use action verbs — "Fix", "Add", "Refactor", "Implement", "Remove", "Investigate"
- **Area**: Infer from domain or technology mentioned — `API`, `Auth`, `UI`, `DB`, `Infra`, `DX`, `Billing`, etc.
- **Keep it scannable**: A teammate should understand the card at a glance on a board

| User says | Title |
|-----------|-------|
| "there's a bug where the login page redirects to 404" | `[Auth] Fix login page redirect to 404` |
| "we need rate limiting on the public API" | `[API] Add rate limiting for public endpoints` |
| "refactor the user list to fix the N+1 query" | `[DB] Fix N+1 query in user list` |
| "investigate why deploys are slow" | `[Infra] Investigate slow deploy times` |

### Type

Infer from the user's language:

| Signal words / context | Type |
|------------------------|------|
| "bug", "broken", "not working", "error", "crash", "regression", "fix" | `bug` |
| "add", "build", "implement", "new feature", "support", "allow users to" | `feature` |
| "refactor", "clean up", "improve", "migrate", "rename", "move", "simplify" | `task` |
| "investigate", "understand", "explore", "research", "figure out", "check if" | `spike` |

When ambiguous, default to `task`.

### Priority

Infer from urgency signals:

| Signal | Priority |
|--------|----------|
| "blocking", "production down", "can't deploy", "urgent", "critical", "right now" | `critical` |
| "before release", "important", "customer-facing", "this week", "high priority" | `high` |
| "should fix", "eventually fix", "not urgent but", no strong signals | `medium` |
| "nice to have", "low priority", "someday", "minor", "cosmetic" | `low` |

When no urgency signal is present, default to `medium`.

### Labels

Infer from domain, technology, and concern type mentioned:

| User mentions | Labels to add |
|---------------|---------------|
| Authentication, login, tokens, JWT, sessions | `auth` |
| API endpoints, REST, GraphQL, rate limiting | `api` |
| Database, queries, migrations, indexes | `db` |
| UI components, styling, layout, dark mode | `ui` |
| Performance, speed, latency, caching | `performance` |
| Security vulnerabilities, XSS, injection | `security` |
| Infrastructure, deployment, CI/CD | `infra` |
| Developer experience, tooling, scripts | `dx` |
| Technical debt, cleanup, refactor | `tech-debt` |
| Testing, coverage, flaky tests | `testing` |

Multiple labels are allowed and encouraged when multiple concerns are present.

### Description

Always generate a structured markdown description. Use what the user said to fill in as much as possible. Leave sections as prompts when information is not available.

**Template**:

```markdown
## Context
{What the problem or need is, derived from user's description}

## Acceptance Criteria
- {Condition 1 that must be true when this is done}
- {Condition 2}
- {Add more as needed}

## Notes
{Any technical context, reproduction steps, constraints, or references mentioned by the user}
```

For **bugs**, include a reproduction section if steps were mentioned:

```markdown
## Context
{Bug description}

## Reproduction Steps
1. {Step 1}
2. {Step 2}
3. Expected: {what should happen}
4. Actual: {what happens instead}

## Acceptance Criteria
- Bug no longer reproduces following the steps above
- {Any additional fix criteria}

## Notes
{Additional context}
```

For **spikes**, use an outcome-oriented template:

```markdown
## Context
{Why this investigation is needed}

## Questions to Answer
- {Question 1}
- {Question 2}

## Deliverable
{What the spike should produce — a decision, a document, a prototype, a recommendation}

## Notes
{Any known constraints or starting points}
```

### Group

Before creating any issue, call `kanon_list_groups(projectKey)` to discover available groups. Match the issue's area or domain keywords against existing group names. If a group matches, include `groupKey` in the creation call.

| Issue area / domain | Group match strategy |
|---------------------|----------------------|
| Area tag in title (e.g., `Auth`, `API`, `UI`) | Match against group names case-insensitively |
| Labels or domain keywords | Match if a group name contains or closely matches the keyword |
| No match found | Omit `groupKey` — do not create groups, only use existing ones |

If multiple groups could match, prefer the most specific one. When unsure, ask the user: "Should this go in the '{group}' group?"

### Default State

Always create with `state: backlog` (the API default). Do not transition the issue unless the user explicitly says it is in progress or ready to start.

---

## Confirmation Pattern

Before calling `kanon_create_issue`, always show a preview card and ask for confirmation. This prevents cluttering the board with misunderstood issues.

**Card preview format**:

```
Here is the issue I would create:

  Title:       [Auth] Fix login page redirect to 404
  Type:        bug
  Priority:    high
  Labels:      auth, ui
  Group:       Authentication       (matched from available groups)
  State:       backlog

  Description:
  ## Context
  The login page redirects to a 404 error page after submitting credentials...
  ...

Create it? [yes / edit / cancel]
```

If the user says "edit" or points out corrections, update the preview and show it again before creating.

If the user says "yes" or similar confirmation, call `kanon_create_issue` and report the created issue key.

---

## Worked Examples

### Example 1: Simple Bug Report

**User input**:
> "There's a bug where logging in with Google OAuth redirects to a 404. Let's track it."

**Inferred structure**:
- Title: `[Auth] Fix Google OAuth redirect to 404`
- Type: `bug`
- Priority: `medium` (no urgency signal)
- Labels: `auth`
- Description: Context with the reported behavior, acceptance criteria that the redirect no longer 404s

**Agent calls `kanon_list_groups("KAN")` and finds groups including `Authentication` (key: `auth-group`).**

**Preview shown to user**:
```
Here is the issue I would create:

  Title:       [Auth] Fix Google OAuth redirect to 404
  Type:        bug
  Priority:    medium
  Labels:      auth
  Group:       Authentication       (matched from available groups)
  State:       backlog

  Description:
  ## Context
  Logging in with Google OAuth redirects to a 404 error page instead of the expected
  post-login destination.

  ## Acceptance Criteria
  - Google OAuth login completes without a 404 redirect
  - User lands on the correct post-login page after authenticating

  ## Notes
  No reproduction steps provided. Investigate OAuth callback URL configuration.

Create it?
```

**User**: "Yes, but make it high priority — it's blocking QA."

**Agent updates and creates**:
```
kanon_create_issue(
  projectKey: "KAN",
  title: "[Auth] Fix Google OAuth redirect to 404",
  type: "bug",
  priority: "high",
  labels: ["auth"],
  groupKey: "auth-group",  // matched "Authentication" group
  description: "..."
)
```

**Agent reports**: "Created KAN-47."

---

### Example 2: Feature Request Mid-Conversation

**User input**:
> "We should add rate limiting to the public API before we go live. Not urgent right now but let's not forget."

**Inferred structure**:
- Title: `[API] Add rate limiting for public endpoints`
- Type: `feature`
- Priority: `low` ("not urgent")
- Labels: `api`, `security`
- Description: Context about pre-launch requirement, acceptance criteria around per-endpoint limits

**Preview shown to user**:
```
Here is the issue I would create:

  Title:       [API] Add rate limiting for public endpoints
  Type:        feature
  Priority:    low
  Labels:      api, security
  State:       backlog

  Description:
  ## Context
  Rate limiting is needed on public API endpoints before the public launch to prevent
  abuse and ensure fair usage.

  ## Acceptance Criteria
  - Rate limits are enforced on all public-facing API endpoints
  - Requests exceeding the limit receive an appropriate error response (e.g., 429)
  - Limits are configurable per endpoint or API key tier

  ## Notes
  Not urgent. To be addressed before public launch.

Create it?
```

**User**: "Yes."

**Agent creates and reports**: "Created KAN-48."

---

### Example 3: Post-Fix Follow-Up Discovery

**Context**: Agent just finished fixing a memory leak in the image upload handler.

**Agent proactively says**:
> "While fixing the memory leak I noticed the video upload handler has the same pattern — it's not leaking yet but it will under load. Want me to create a follow-up issue for it?"

**User**: "Yeah track it."

**Inferred structure**:
- Title: `[Media] Fix potential memory leak in video upload handler`
- Type: `bug` (potential bug, proactive fix)
- Priority: `medium`
- Labels: `performance`

**Preview shown and confirmed, then created**: "Created KAN-49."

---

### Example 4: Vague Task Description

**User input**:
> "Add a task to investigate why our CI builds are taking so long."

**Inferred structure**:
- Title: `[Infra] Investigate slow CI build times`
- Type: `spike`
- Priority: `medium`
- Labels: `infra`, `dx`
- Description: Questions-to-answer format with deliverable being a recommendation

**Preview shown to user**:
```
Here is the issue I would create:

  Title:       [Infra] Investigate slow CI build times
  Type:        spike
  Priority:    medium
  Labels:      infra, dx
  State:       backlog

  Description:
  ## Context
  CI builds are running slowly. Root cause is unknown. Investigation needed to identify
  bottlenecks and recommend improvements.

  ## Questions to Answer
  - What are the slowest steps in the build pipeline?
  - Are there caching opportunities not currently utilized?
  - Is the slowness consistent or intermittent?

  ## Deliverable
  A written recommendation with specific changes to reduce build time.

  ## Notes
  No baseline timing data provided. Start by capturing current step-by-step timing.

Create it?
```

**User**: "Looks good, create it."

**Agent creates and reports**: "Created KAN-50."

---

## Integration — `kanon_create_issue` Reference

```
kanon_create_issue(
  projectKey: "{projectKey}",     // required — get from project context
  title: "{title}",               // required — [Area] Imperative description
  type: "feature|bug|task|spike", // optional — inferred from NL
  priority: "critical|high|medium|low",  // optional — inferred from NL
  description: "{markdown}",      // optional — structured markdown
  labels: ["{label1}", ...],      // optional — inferred from domain/tech
  // Other optional fields when context provides them:
  groupKey: "{groupKey}",         // from kanon_list_groups — match area/domain to group
  assigneeId: "{userId}",         // if user specifies "assign to X"
  dueDate: "{ISO-date}"           // if deadline is mentioned
)
```

The tool returns the created issue object including its `issueKey` (e.g., `KAN-42`). Always report this key to the user after creation.

**Before creating**, call `kanon_list_issues(projectKey, ...)` with relevant filters (type, label) to check for duplicates. If a similar issue exists, surface it to the user: "There is already an open issue that looks related: KAN-35 '[Auth] OAuth callback configuration'. Is this the same thing, or a separate issue?"

---

## Edge Cases and Clarifications

**When the project key is unknown**: Ask the user or call `kanon_list_projects` to find it. Do not guess.

**When the description is very short**: Generate a minimal but valid description. It is better to create a sparse issue than to block on asking for details. The user can enrich it later.

**When the user provides conflicting signals** (e.g., "not urgent but this is critical"): Favor the strongest concrete signal. If truly ambiguous, ask: "Should I mark this high or medium priority?"

**When the issue is actually a roadmap item**: If the user uses language like "someday", "eventually", "down the road", or "it would be nice if", consider whether this belongs on the roadmap instead of the backlog. Reference the `kanon-roadmap` skill and suggest: "This sounds more like a roadmap item than an actionable issue — want me to add it to the roadmap instead?"

**When multiple issues are implied**: If the user describes multiple distinct problems or features in one message, identify each one and offer to create separate issues: "I see two things here. Want me to create separate issues for both?"

---

## Best Practices

1. **Always preview first** — Never create an issue without showing the structured card and getting confirmation.
2. **Titles are for humans** — Every title should be scannable on a board by someone who was not in this conversation.
3. **Infer boldly, adjust gracefully** — Make confident inferences from the NL input. If the user corrects you, update immediately without argument.
4. **Check for duplicates** — A quick `kanon_list_issues` with a label or type filter before creation prevents board clutter.
5. **Report the issue key** — Always echo the created issue key (e.g., "Created KAN-42") so the user has a reference.
6. **Default to backlog** — Issues created here are not yet in progress. Let the user or workflow move them forward.
7. **Structured descriptions matter** — A person opening the card later should understand what to do without needing this conversation.
8. **Roadmap vs issue** — If the request is exploratory or clearly deferred, suggest the roadmap. Do not cram everything into the backlog.
9. **Check groups before creating** — Always call `kanon_list_groups(projectKey)` and assign `groupKey` when a match exists. Ungrouped issues are harder to find on the board.

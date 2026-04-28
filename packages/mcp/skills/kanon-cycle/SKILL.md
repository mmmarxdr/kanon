---
name: kanon-cycle
description: Cycle planning, scope management, and close discipline — create cycles, attach/detach issues with audit trail, read burnup/risks, and choose the right close disposition.
version: 1.0.0
tags: [kanon, cycle, sprint, planning, scope-management]
allowed-tools:
  - kanon_*
  - mem_save
  - mem_search
  - mem_get_observation
---

# Kanon Cycles — Planning & Scope Management

Cycles (a.k.a. sprints) bound a window of focused work — fixed start/end dates, an explicit goal, and the issues attached to it. The agent's job is to **plan cycles cleanly, manage scope changes with reasons, and close cycles with the right disposition for what remains**.

---

## Core Philosophy

| Concept | Meaning |
|---------|---------|
| **Cycle** | Time-boxed unit of work with a goal, dates, and a scope of issues |
| **Scope** | The issues attached to the cycle at any given moment |
| **Scope event** | An audit row recording every add/remove with day, author, and reason |
| **Burnup** | Daily completed-issue count, used to read pace and risk |
| **Disposition** | What happens to unfinished issues at close — `move_to_next` / `move_to_backlog` / `leave` |

**One project, one active cycle at a time.** Creating a new cycle in `active` state demotes any current active cycle on that project.

---

## Project Resolution (mandatory)

The user should never need to type a project key. Infer it from `cwd` basename, resolve via `kanon_list_projects(workspaceId)`, cache for the session. Refer to projects by human-readable name. If no match, suggest `/kanon-init`.

---

## Cycle States

| State | Meaning |
|-------|---------|
| `upcoming` | Planned but not yet started |
| `active` | Currently running — only one per project |
| `done` | Closed; velocity computed |

**`isActive` flag is authoritative.** Do NOT infer activity from dates; always read `isActive` from `kanon_list_cycles`.

---

## Tools at a glance

| Need | Tool |
|------|------|
| List cycles for a project | `kanon_list_cycles(projectKey)` — entries include `isActive` |
| Cycle detail | `kanon_get_cycle(cycleId)` — burnup, scope events (last 20 by default), risks, issues |
| Full audit trail | `kanon_get_cycle(cycleId, includeAllScopeEvents: true)` |
| Create cycle | `kanon_create_cycle({ projectKey, name, goal, startDate, endDate, state?, attachIssueKeys? })` |
| Attach / detach | `kanon_attach_issues_to_cycle({ cycleId, add[]?, remove[]?, reason? })` |
| Close cycle | `kanon_close_cycle({ cycleId, disposition, projectKey?, reason? })` |

`startDate` and `endDate` accept `YYYY-MM-DD` (auto-normalized to ISO).

`add` and `remove` arrays take **issue keys** (e.g. `KAN-42`), not UUIDs.

---

## Planning a New Cycle

When the user signals "start a new cycle / sprint":

1. **Infer the project** (Project Resolution above).
2. **List existing cycles**: `kanon_list_cycles(projectKey)` to see what is active and find the next chronological slot.
3. **Confirm scope before creating**:
   - Cycle name (e.g. `Cycle 13`, `Q2 / week 1`, `Auth hardening sprint`)
   - Goal in one sentence — what success looks like
   - Start and end dates (default to a 2-week window if the user does not specify)
   - Initial issues to attach (optional — pass keys via `attachIssueKeys`)
4. **Create with `state: 'active'`** only when the user explicitly wants it running now. Otherwise default to `upcoming`. Activating demotes the current active cycle silently — surface that in your reply.
5. After create, return: `cycleId`, `name`, `state`, count of attached issues, and the goal. Nothing more.

---

## Scope Changes Mid-Cycle

Adding or removing issues from an in-flight cycle **always** uses `kanon_attach_issues_to_cycle`. Pass a `reason` — it lands in the audit trail and reads as a sentence in retros:

| Direction | Typical reasons |
|-----------|-----------------|
| `add` | "Customer escalation", "Triage incoming bug", "Atomic split — needed to land KAN-X" |
| `remove` | "Deferred to next cycle — unblocked dependency arrived late", "Out of scope after design review" |

**Cross-project safety**: the API rejects attaches whose issue belongs to a different project. Read the error and route the user to fix the issue's project, not retry blindly.

**Idempotency**: re-adding an already-attached issue is a no-op. Removing a not-attached issue is a no-op. The scope-event row is still written so the audit reflects intent.

---

## Reading a Cycle's Health

`kanon_get_cycle(cycleId)` returns burnup data + computed risks. Use them; do not eyeball.

- **`scope`**: total issues currently attached
- **`completed`**: issues in `done` state
- **`dayIndex` / `days`**: progress through the cycle window
- **`burnup` / `scopeLine`**: daily series for plotting and pace checks
- **`risks[]`**: pre-computed warnings (e.g. `behind-pace`, `scope-creep`). Surface them verbatim — do not paraphrase severity.

When the user asks "how is the cycle going?", answer with: dayIndex / days, completed / scope, and the highest-severity risk title + action. Skip the rest unless asked.

---

## Closing a Cycle

`kanon_close_cycle(cycleId, disposition, ...)` finalizes the cycle and decides what happens to **unfinished** issues attached to it. Pick disposition deliberately:

| Disposition | When to use | Required args |
|-------------|-------------|---------------|
| `move_to_next` | Continuing the same line of work into the next cycle | `projectKey` (must have an `upcoming` or active next cycle on that project) |
| `move_to_backlog` | The work is still real but not next-cycle priority | none |
| `leave` | Issues stay attached to the closed cycle (rare — mostly for retro analysis) | none |

Always pass `reason` for non-trivial closes. The default response is an `ack` with the moved issue keys; use `format: 'full'` only when the caller wants the closed cycle entity back.

**Velocity is computed at close.** Do not try to set it manually.

---

## Audit Trail Discipline

Every scope change writes a `CycleScopeEvent` row. The agent should:

- Always pass a meaningful `reason` on `attach_issues_to_cycle` — "no reason given" is itself a smell.
- When investigating "why was this issue removed?", call `kanon_get_cycle(cycleId, includeAllScopeEvents: true)` and read events in chronological order.
- Save retros / cycle close summaries to engram with `topic_key: cycle/{name}/retro` so future cycles can mine them.

---

## Format Tiers

All cycle tools accept `format: 'ack' | 'slim' | 'full'`. Default is `ack` for writes and `slim` for reads. Only request `full` when the caller actually needs the entity (UI render, deep audit). Saves tokens on every call.

---

## Common Recipes

### "Start cycle 13, attach the 3 highest-priority backlog items, and run it"
1. Resolve `projectKey`.
2. `kanon_list_issues(projectKey, state: 'backlog', priority: 'critical' | 'high', limit: 3)` → collect keys.
3. `kanon_create_cycle({ projectKey, name: 'Cycle 13', goal: <one-liner>, startDate, endDate, state: 'active', attachIssueKeys: [keys] })`.
4. Reply with cycle id, attached count, and a heads-up if a previous active cycle was demoted.

### "What is the current cycle and how is it going?"
1. `kanon_list_cycles(projectKey)` → find `isActive: true`.
2. `kanon_get_cycle(cycleId)`.
3. One-line health summary + top risk.

### "Close cycle 12 — move unfinished to cycle 13"
1. Verify cycle 13 exists in `upcoming` state on that project.
2. `kanon_close_cycle({ cycleId: <12>, disposition: 'move_to_next', projectKey, reason: 'Cycle close — overflow to 13' })`.
3. Reply with moved issue keys.

### "What changed in the cycle this week?"
1. `kanon_get_cycle(cycleId, includeAllScopeEvents: true)`.
2. Filter scope events by `day >= dayIndex - 7`. Group by `kind` (add/remove) and summarize with reasons.

---

## Best Practices

1. **Never silently activate** — if creating an active cycle demotes another one, say so.
2. **Always pass a `reason`** on attach/detach during an active cycle.
3. **Read `isActive`, not dates.** Dates can be stale; the flag is computed.
4. **Keep cycle names short and serial** — `Cycle N` or theme + N. Avoid embedding dates in the name; the cycle already stores them.
5. **Disposition is a judgment call** — confirm with the user before `move_to_next` if you are unsure where the work belongs.
6. **Save retros** with `topic_key: cycle/{name}/retro` so future cycles can learn from past ones.

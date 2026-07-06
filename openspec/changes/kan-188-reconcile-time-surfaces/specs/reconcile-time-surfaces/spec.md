# reconcile-time-surfaces Specification

## Purpose

Make the existing `POST /api/issues/:key/reconcile-time` endpoint reachable from every
transition→done surface (MCP, web) so unconfirmed captured time no longer dead-ends the
user at `409 RECONCILIATION_REQUIRED`. Extends the reconcile boundary with a confirmed-total
override so hours can be corrected up or down, and wires a confirm-or-adjust flow into MCP
and web transition paths. Reconcile gate semantics (ADR-0001 amendment) are preserved
unchanged; CLI remains read-only and out of scope.

## Requirements

### Requirement: Confirmed-total override on ReconcileTimeBody

The system MUST accept an explicit confirmed-total override field on
`ReconcileTimeBody` (`packages/api/src/modules/issue/schema.ts`), distinct from the
existing additive `addHours` field. The override value MUST be a non-negative decimal
string capped at 744 (same upper-bound style as `addHours`). When provided, the override
MUST set the issue's confirmed total hours authoritatively (able to correct downward),
not add to existing hours.

The system MUST NOT accept both `addHours` and the override in the same request — a
request containing both MUST be rejected with a `400` validation error before any
reconcile side effect runs.

#### Scenario: Override corrects hours downward

- GIVEN an issue with 6 captured hours (unconfirmed)
- WHEN a client calls reconcile-time with the confirmed-total override set to `4`
- THEN the issue's confirmed total becomes `4` hours
- AND `issue.timeConfirmedAt` is stamped
- AND no additive top-up entry is created

#### Scenario: Override accepts hours as-is (no change)

- GIVEN an issue with 3 captured hours (unconfirmed)
- WHEN a client calls reconcile-time with the confirmed-total override set to `3`
- THEN the issue's confirmed total remains `3` hours
- AND `issue.timeConfirmedAt` is stamped

#### Scenario: Override value below zero is rejected

- GIVEN a reconcile-time request
- WHEN the confirmed-total override is a negative number or not a valid non-negative
  decimal string
- THEN the request MUST be rejected with a `400` validation error
- AND no database write occurs

#### Scenario: Override exceeding the upper bound is rejected

- GIVEN a reconcile-time request
- WHEN the confirmed-total override exceeds `744`
- THEN the request MUST be rejected with a `400` validation error

#### Scenario: Both addHours and override provided is rejected

- GIVEN a reconcile-time request body containing both `addHours` and the confirmed-total
  override
- WHEN the request is validated
- THEN the request MUST be rejected with a `400` validation error before any reconcile
  logic executes
- AND `issue.timeConfirmedAt` is NOT modified

### Requirement: Reconcile gate clearance and audit trail preserved

`reconcileIssueTime` MUST remain the only path that clears the review→done gate by
stamping `issue.timeConfirmedAt`, using the existing `>=` staleness comparison and the
+1ms stamp-past-newest-entry guard. Every TimeEntry written by the confirmed-total
override path MUST record a `via` value that distinguishes it from the additive
top-up and promotion paths, since no `AuditLog` table exists — `TimeEntry.via` is the
audit trail for reconcile actions.

#### Scenario: Override path stamps a distinguishable via value

- GIVEN a reconcile-time request using the confirmed-total override
- WHEN the override is applied
- THEN any TimeEntry created or adjusted by the override records `via: "reconcile-override"`
- AND this value is distinct from `"reconcile"` (auto-promotion) and `"reconcile-manual"`
  (additive top-up)

#### Scenario: Additive addHours path is unaffected

- GIVEN a reconcile-time request using only `addHours` (no override)
- WHEN the request is processed
- THEN existing additive behavior is preserved exactly as before this change
- AND the manual top-up entry continues to record `via: "reconcile-manual"`

### Requirement: MCP confirm-or-adjust flow on transition to done

When an MCP agent transitions an issue to `done` and the transition is blocked by
`409 RECONCILIATION_REQUIRED`, the MCP layer MUST surface the reported captured hours
from the 409 payload to the user, and MUST provide a way for the agent to reconcile
with either the reported total (accept-as-is) or an adjusted total, before retrying the
transition to `done`.

#### Scenario: Agent accepts reported hours as-is

- GIVEN an issue has 5 unconfirmed captured hours
- WHEN the agent calls `kanon_transition_issue` to move it to `done`
- THEN the tool call is blocked and the response surfaces "5 hours were reported on this
  ticket — accept, or change the hours?"
- AND WHEN the agent confirms acceptance
- THEN the issue is reconciled with a confirmed total of 5 hours and the transition to
  `done` succeeds

#### Scenario: Agent adjusts reported hours before confirming

- GIVEN an issue has 5 unconfirmed captured hours
- WHEN the agent transitions the issue to `done` and is shown the reported hours
- AND the agent supplies an adjusted total of 4.5 hours
- THEN the issue is reconciled with a confirmed total of 4.5 hours
- AND the transition to `done` succeeds

#### Scenario: 409 payload carries captured hours for the agent to surface

- GIVEN an issue with unconfirmed captured time
- WHEN a transition to `done` is attempted and blocked
- THEN the error payload available to the MCP layer MUST include the total captured
  hours so the agent can present them to the user without a second round-trip

#### Scenario: Zero captured time never triggers the confirm-or-adjust flow

- GIVEN an issue has zero captured time
- WHEN the agent transitions it to `done`
- THEN the transition succeeds directly with no reconcile prompt

### Requirement: Web confirm-or-adjust modal on transition to done

When a web user moves an issue to `done` (single-issue or group transition) and the
issue has unconfirmed captured time, the web client MUST open a modal displaying the
captured hours before completing the transition. The modal MUST allow an optional
adjustment to the confirmed total and MUST require explicit user confirmation before
reconcile-and-transition proceeds. A one-click silent transition MUST NOT occur when
reconciliation is required.

#### Scenario: Single-issue transition intercepts the 409 and opens the modal

- GIVEN a board user drags an issue with unconfirmed captured time into the `done` column
- WHEN `use-transition-mutation` receives `409 RECONCILIATION_REQUIRED`
- THEN a modal opens showing the captured hours
- AND the transition is NOT applied until the user confirms

#### Scenario: User confirms hours as-is in the modal

- GIVEN the reconcile modal is open showing 3 captured hours
- WHEN the user confirms without adjusting the value
- THEN reconcile-time is called with a confirmed total of 3
- AND the issue then transitions to `done`

#### Scenario: User adjusts hours in the modal before confirming

- GIVEN the reconcile modal is open showing 3 captured hours
- WHEN the user changes the value to 2.5 and confirms
- THEN reconcile-time is called with a confirmed total of 2.5
- AND the issue then transitions to `done`

#### Scenario: Group transition intercepts the 409 per-issue

- GIVEN a group of issues is batch-transitioned to `done` via
  `use-group-transition-mutation`
- WHEN one or more issues in the group return `409 RECONCILIATION_REQUIRED`
- THEN each such issue MUST surface its own reconcile modal (or an equivalent per-issue
  confirm step) with its own captured hours
- AND an issue that does not require reconciliation transitions without a modal

#### Scenario: Mutation cache invalidation after reconcile-and-transition

- GIVEN a web transition (single or group) completes reconcile-then-done successfully
- WHEN the mutation settles
- THEN the invalidation MUST hit the same `issueKeys`/`cycleKeys` query-key factories
  already used by the pre-existing `onSettled` invalidation for that mutation

### Requirement: Regression gate for the full capture-to-done path

The system MUST have an automated test proving the full supported path
`start_work → stop_work → transition→done` succeeds end-to-end through the reconcile
flow, so a backend-only (unreachable) reconcile capability can never ship again
without failing this test.

#### Scenario: Full path is green through the supported reconcile surface

- GIVEN an issue with no prior captured time
- WHEN a member starts work, stops work (creating unconfirmed captured time), and the
  transition to `done` is attempted
- THEN the 409 is surfaced, reconcile is invoked with either accept-as-is or an
  adjusted total, and the transition to `done` then succeeds
- AND the test fails if any step in this chain is not reachable through a real
  client-facing surface (MCP tool call or web mutation), not a direct service-layer call

## Non-Goals

- CLI is read-only (`status` command only) and is not a reconcile surface.
- No redesign of the reconciliation/approve model; no new ADR.
- Instance-level configurability of the ask-and-confirm flow is deferred.
- No Prisma schema migration.

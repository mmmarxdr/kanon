# PM Integration Inbound Sync Specification

## Purpose

Apply changes. KAN-192 tracking metadata.

## Requirements

### Requirement: PMIS-01 Linked Polling Scope

`PollingInboundSource` MUST use stable cursor ordering and a same-timestamp tie-breaker. Initial polling MUST NOT backfill or import Redmine-created issues; it MAY process linked issues only. For trusted active Redmine, a mapped close MUST request `done`. If only blocked by unconfirmed captured time, it MUST invoke existing reconciliation with current reported total unchanged, record external-integration provenance/audit, notify acceptance, then retry `done`; it MUST NOT adjust hours. Any other blocker MUST create a queryable conflict containing requested close, reason, issue/link identity, and audit provenance, without `done`. Dead letters are only for transport/retry exhaustion. Webhooks, Jira, and custom fields are out of scope.

#### Scenario: Linked PM close
- GIVEN a linked Redmine issue changes to a mapped PM-owned closed status
- WHEN a poll applies the change
- THEN the linked Kanon issue transitions to `done`

#### Scenario: Close auto-accepts reported time only
- GIVEN a trusted active connection and `done` is blocked only by unconfirmed captured time
- WHEN a mapped remote close is applied
- THEN reported total is accepted unchanged and `done` is retried

#### Scenario: Automatic acceptance is attributable
- GIVEN automatic time acceptance succeeds for a remote close
- WHEN the inbound result is recorded
- THEN external-integration provenance, audit evidence, and an owner-visible notice are available

#### Scenario: Non-time close blocker is not bypassed
- GIVEN a mapped remote close is blocked for a reason other than unconfirmed time
- WHEN the inbound worker applies it
- THEN it records a queryable conflict with close, reason, issue/link identity, and audit provenance, without transitioning to `done` or adjusting hours

#### Scenario: Unlinked historical issue
- GIVEN an unlinked or pre-activation Redmine issue appears in a poll range
- WHEN polling runs
- THEN no Kanon issue is imported or created

### Requirement: PMIS-02 Durable Page Application and Conflict Evidence

The system MUST advance a cursor only after the complete page is durably applied, and MUST replay a partially failed page safely. For a same-field conflict, it MUST compare durable local-version and remote/baseline evidence, apply deterministic field ownership, and create a queryable conflict record rather than silently losing a value. Kanon owns assignee, estimate, dates, progress, and its configured status segment; Redmine owns only its configured status segment.

#### Scenario: Partial page failure replays
- GIVEN page application fails after one change
- WHEN the worker resumes
- THEN the cursor has not advanced past the page and replay is idempotent

#### Scenario: Both sides changed
- GIVEN local and remote changes since their common baseline for one field
- WHEN reconciliation runs
- THEN the configured owner wins and the losing value and evidence are recorded

### Requirement: PMIS-03 Correlated Echo Prevention

Inbound-originated mutations MUST retain durable origin and correlation evidence. Outbound listeners MUST suppress only the matching correlated echo, not a later genuine local edit; time-window-only suppression is insufficient.

#### Scenario: Matching echo is suppressed
- GIVEN a local mutation was applied from remote change correlation C
- WHEN its outbound listener observes the correlated event
- THEN it creates no echo write

#### Scenario: Later local edit still syncs
- GIVEN correlation C was consumed and a user makes a later mapped edit
- WHEN the listener observes that edit
- THEN it creates outbound work despite any elapsed suppression window

### Requirement: PMIS-04 Supported Delete Cleanup

Where the product provides a hard-delete lifecycle hook, the system MUST remove linked external references within that supported lifecycle transaction. Cycle hard-delete cleanup is mandatory; issue or project cleanup is required only if such a supported hook exists and MUST NOT invent a new hard-delete path.

#### Scenario: Cycle deletion cleans link
- GIVEN a cycle has linked external references
- WHEN the supported cycle hard-delete runs
- THEN those references are removed atomically with deletion

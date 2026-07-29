# PM Integration Outbound Sync Specification

## Purpose

Deliver attributable, durable Kanon-to-provider changes without duplicate storms or silent loss.

## Requirements

### Requirement: PMOS-01 Initiator Credentials and Identity

For a user-originated write, the system MUST authenticate with the real initiating actor's personal credential. Assignee external-identity mapping MUST be independent of authentication. If the actor has no credential, the write MUST be skipped and surfaced unless an owner-enabled service fallback is explicitly applicable; it MUST be auditable and never silently substituted. System or AI events MUST use only an explicitly configured service credential or remain unsent. Inbound external actors MUST be recorded as remote actors, not impersonated Kanon members.

#### Scenario: User write uses actor credential
- GIVEN a connected developer changes a mapped issue field
- WHEN outbound sync runs
- THEN the provider request authenticates as that developer, not the assignee or another member

#### Scenario: Missing or non-user credential
- GIVEN an unconnected actor or a system/AI event without enabled service fallback
- WHEN it triggers sync
- THEN no provider write occurs and the coverage/audit surface records the reason

### Requirement: PMOS-02 Durable Idempotent Dispatch

Before creating a remote issue, the system MUST durably record the intended sync work and correlation identity. Retries after timeout or uncertain outcome MUST reconcile using stable provider/link evidence and MUST NOT silently create duplicate remote issues or lose work.

#### Scenario: Create timeout is reconciled
- GIVEN remote creation times out after durable work is recorded
- WHEN the work is retried
- THEN the system reconciles the existing remote/link or performs one idempotent creation

#### Scenario: Persistence fails first
- GIVEN durable work cannot be recorded
- WHEN a new remote issue would otherwise be created
- THEN remote creation MUST NOT be attempted

### Requirement: PMOS-03 Retry, Dead Letters, and Backpressure

The system MUST classify retryable and terminal failures, use bounded global and per-connection concurrency, and honor provider throttling with jittered backoff. A scheduler MUST automatically redrive all due queued retryable work after transient outage or recovery without manual intervention. Exhausted or terminal work MUST enter a queryable dead-letter state; controlled authorized requeue MUST retain correlation and audit history.

#### Scenario: Transient outage backlog is automatically redriven
- GIVEN an outage queues N retryable work items
- WHEN the provider recovers and their schedules become due
- THEN the scheduler redrives all N without manual action using bounded concurrency and jittered backoff

#### Scenario: Terminal failure is retained
- GIVEN work reaches its configured retry limit or a terminal error
- WHEN the worker classifies the failure
- THEN it enters a queryable dead-letter state and is not discarded

#### Scenario: Dead letter is requeued deliberately
- GIVEN an authorized operator selects a queryable dead letter
- WHEN the operator requeues it
- THEN its audit history is retained and one controlled retry is scheduled

### Requirement: PMOS-04 Relevant Coalesced Events

The system MUST dispatch only events that change mapped fields and MUST coalesce near-simultaneous eligible events per issue without suppressing a later distinct edit.

#### Scenario: Irrelevant update is ignored
- GIVEN only an unmapped issue field changes
- WHEN `issue.updated` is observed
- THEN no outbound work is created

#### Scenario: Batch burst coalesces
- GIVEN repeated eligible events for one issue during a burst
- WHEN dispatch is scheduled
- THEN at most one work item represents that burst

### Requirement: PMOS-05 Actual Role-Ceiling Outcome

The system MUST report requested and actual remote status for accepted, rejected, and no-op status writes. It MUST NOT claim a “furthest allowed” status unless that status is deterministically discovered.

#### Scenario: Remote status differs
- GIVEN a requested status is rejected or silently unchanged by the provider
- WHEN the result is observed
- THEN the recorded outcome identifies requested and actual status and is queryable

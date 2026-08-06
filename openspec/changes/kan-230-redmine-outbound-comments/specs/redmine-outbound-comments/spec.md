# Redmine Outbound Comments Specification

## Requirements

### Requirement: Atomic Eligible Comment Capture
The system MUST atomically persist eligible public comment, activity, and replay-safe outbound work. Unlinked/ineligible comments MUST remain local and create no outbound work.

#### Scenario: Capture an eligible comment
- GIVEN a public comment on an issue with an active Redmine link
- WHEN the comment is created
- THEN the comment, activity, and outbound work are committed together

#### Scenario: Keep an ineligible comment local
- GIVEN an issue without an active Redmine link
- WHEN the comment is created
- THEN no outbound work is persisted

### Requirement: Pre-I/O Delivery Fence
Before provider I/O, the system MUST validate operation=create, unchanged public comment, parent reference, active binding/epoch, credential ID/non-secret version, and capability. Deleted/changed comments, missing parent reference, stale/revoked/replaced credentials, stale epoch, unsupported capability/operation, or unlinked issues MUST perform no provider I/O and leave durable terminal/conflict evidence.

#### Scenario: Dispatch fenced work
- GIVEN queued work whose complete snapshot still matches current state
- WHEN the worker dispatches it
- THEN provider I/O is permitted

#### Scenario: Reject stale work
- GIVEN queued work with any failed fence condition
- WHEN the worker dispatches it
- THEN no provider request occurs and durable terminal/conflict evidence is recorded

### Requirement: One-Attempt Marked Redmine Note
The system MUST create a Redmine journal using a note-specific ONE-ATTEMPT request with `private_notes:false`; it MUST NOT use generic retrying PUT. It MUST append exactly `<!-- kanon-comment:<local-comment-uuid> -->`, from the immutable local UUID once to the remote note. The marker MUST NOT alter the local body.

#### Scenario: Write a marked public note
- GIVEN fenced eligible work for a Redmine-capable binding
- WHEN delivery is attempted
- THEN one non-retrying public note request contains the exact UUID marker
- AND the local comment body remains marker-free

#### Scenario: Transport uncertainty
- GIVEN the one-attempt request has an indeterminate result
- WHEN delivery handling continues
- THEN no generic retrying request is issued

### Requirement: Marker-Proven Ambiguity Resolution
The system MUST make at most one blind write per item. After uncertainty it MUST perform bounded marker reconciliation: one unique provable matching journal finalizes delivery; zero or multiple unprovable matches MUST enter durable manual conflict. The guarantee SHALL be effectively-once with marker proof and safe conflict, not unconditional exactly-once.

#### Scenario: Prove a unique journal
- GIVEN ambiguous work and one journal with a valid matching marker
- WHEN reconciliation runs
- THEN delivery is finalized with that journal identity

#### Scenario: Preserve ambiguity safely
- GIVEN ambiguous work with zero or multiple unprovable marker matches
- WHEN reconciliation completes
- THEN durable manual conflict evidence is recorded
- AND no second blind write occurs

### Requirement: Secure Inbound Echo Attachment
Inbound polling MUST recognize a marked journal only when binding, parent issue, local UUID, and outbound work validate. It MUST attach remote identity to the original comment, record echo handling, and create no duplicate, including a finalization race.

#### Scenario: Attach a valid echo
- GIVEN inbound polling observes a valid marked journal
- WHEN all marker associations validate
- THEN the original comment receives the remote journal identity and echo evidence
- AND no duplicate comment is created

#### Scenario: Reject a spoofed marker
- GIVEN a journal marker with mismatched binding, parent issue, UUID, or work
- WHEN inbound polling processes it
- THEN it is not attached as an echo

### Requirement: Safe Rollback and Scope Boundary
The system MUST support disabling capture and dispatch while retaining marker recognition for already in-flight work. It MUST NOT add migrations, edit/delete synchronization, private delivery, remote-authorship claims, historical privacy/tombstone audits, operations UI, or broader polling hardening.

#### Scenario: Disable outbound delivery safely
- GIVEN capture and dispatch are disabled during rollback
- WHEN an in-flight marked journal is polled
- THEN marker recognition remains available for reconciliation

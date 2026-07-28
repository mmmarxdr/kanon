# Immutable Triage Proposals Specification

## Purpose

Persist an eligible triage preview only through a separate explicit action, discover and read it through a bounded project review queue, and dismiss it explicitly without making the immutable record executable.

## Terms

- **Proposal content** is the contract version and kind; workspace, project, target, source version/hash/snapshot and source seal; authorization policy version; normalized recommendation payload; evidence, reasons, confidence, policy/model provenance; effective scope and degradation; initiator, client, generator, creation time, trace identity; future approval policy/risk metadata; expiry and retention metadata; and an optional `supersedes` link.
- **Normalized recommendation payload** is a canonical representation of all retained canonical actions, metadata-only recommendations, and duplicate-candidate conclusions. Object keys and unordered sets are sorted; duplicate set values are removed; canonical domain identifiers are used; absent means no recommendation and is distinct from an explicit clear. Reasons, evidence wording, confidence, timestamps, and initiator are not part of this payload.
- **Generator identity** is the generator kind, identifier, and version; deterministic policy identity/version; and provider/model/model-version whenever host AI contributed.
- **Authorization policy version** is the immutable version of the authorization semantics used for target/candidate visibility, effective scope, and proposal access. Any preview identity, source seal, proposal identity, or list cursor whose validity depends on authorization MUST bind this version.
- **Preview identity** identifies one newly executed preview. A **source seal** is an opaque, canonical seal over its target and retained-candidate snapshots, effective scope, authorization policy version, contract version, and search/ranking policy versions.
- **Exact proposal identity** is contract version plus authorization policy version, workspace and project scope, stable target issue identity, source seal, source version and hash, normalized recommendation payload, and generator identity.
- **Lifecycle** is exactly `pending`, `dismissed`, or `expired`. A proposal is **current** only while it is pending, before its expiry time, and not superseded.
- **Expiration** ends current validity but preserves the immutable record. **Retention** controls how long the non-current record remains available before an explicit, audited disposition.
- **Effective proposal state** for get/list is `current`, `superseded`, `dismissed`, `expired`, or `disposed`, evaluated in precedence order `disposed`, `dismissed`, `expired`, `superseded`, then `current`. `disposed` exposes only policy-allowed disposition metadata, never disposed content.
- **List snapshot** is the proposal-state view fixed by the first page's evaluation time and source marker. Authorization is re-evaluated on every page; later pages either continue the authorized snapshot or fail with authorization or source conflict.

## Requirements

### Requirement: Persistence is explicit and role-gated

A triage proposal MUST be created only by a separately invoked persistence action; preview MUST NOT invoke it implicitly. Creation MUST require an effective project role of member or higher and current target-issue visibility. Before creation, the action MUST reauthorize the target and every retained candidate against current project/token scope and the authorization policy version bound to the preview. Get and list MUST be allowed to a viewer or higher only while the reader can currently view the target issue and project. Authorization MUST be re-evaluated on every create, get, list, lifecycle, and supersession request.

A missing and a non-visible proposal, target, or project MUST produce the same permission-safe outcome and MUST reveal no content, lifecycle, workspace/project identity, existence, or count. A viewer MAY get and list but MUST NOT create, dismiss, or supersede.

#### Scenario: Member explicitly persists

- GIVEN an eligible preview and a caller with member access to its target
- WHEN the caller separately invokes persistence
- THEN one triage proposal is returned
- AND its initiator and creation time identify that explicit action

#### Scenario: Viewer remains read-only

- GIVEN a viewer can read the target issue and its triage proposal
- WHEN the viewer reads and then attempts to create or dismiss a proposal
- THEN read succeeds
- AND each write fails authorization with no domain change

#### Scenario: Permission loss hides the record

- GIVEN a caller previously read a proposal
- AND the caller loses target-issue visibility
- WHEN the caller reads it again
- THEN the result is indistinguishable from a missing proposal
- AND no content or lifecycle detail is returned

### Requirement: Proposal discovery is project-scoped and server-paginated

The MCP proposal-list capability MUST require exactly one project, MUST list only typed triage proposals whose targets are currently visible to the viewer, and MUST NOT support workspace-wide listing in this slice. The server MUST apply project and target visibility before state filtering, matching, counting, ordering, and cursor creation. The only list filters MUST be effective state (`current` by default, or `superseded`, `dismissed`, `expired`, `disposed`, `all`), exact target issue reference, generator source (`deterministic_policy`, `host_ai`, `mixed`), and degraded (`true` or `false`); unsupported or malformed filters MUST fail validation.

The limit MUST default to 20 and MUST be an integer from 1 through 50. Results MUST order by creation time descending and then stable proposal identifier descending. `compact` MUST be the default and only list projection: proposal ID, typed kind/version, target reference, normalized action kinds, effective state/current flag, created/expiry times, generator/policy/model summary, confidence bands, degradation flag, and supersession reference. Full retained content, evidence, reasons, source snapshot, and lifecycle history MUST require get; disposed content MUST remain unavailable. The response MUST expose returned authorized count and an opaque next cursor only when another authorized row exists; it MUST NOT expose total, excluded, scanned, forbidden, or workspace counts.

The cursor MUST be opaque, MUST contain no readable proposal or domain data, and MUST bind project, normalized filters, compact projection, order version, caller authorization context, authorization policy version, list snapshot, and last ordered row. New proposals after the first page MUST not enter that snapshot. If authorization or proposal/lifecycle changes prevent consistent continuation, the server MUST return a permission-safe authorization result or source conflict rather than skip, duplicate, reorder, or restart silently. Expiry MUST be evaluated at the snapshot time. Disposed entries MUST appear only for an explicit `disposed` or `all` filter, only when retention policy permits discovery, and only as bounded disposition metadata.

#### Scenario: Viewer pages a compact project queue

- GIVEN a viewer can see project A and more than 20 current proposal targets
- WHEN the viewer lists with default inputs
- THEN only current project-A triage proposals are returned in stable newest-first order
- AND 20 compact rows and an opaque next cursor are returned

#### Scenario: Hidden proposals do not affect list cardinality

- GIVEN project A contains proposals for visible and forbidden targets
- WHEN a viewer lists project A
- THEN authorization removes forbidden targets before filter and order
- AND returned count, positions, cursor, and error metadata are the same as if forbidden proposals did not exist
- AND no total, excluded, or forbidden count is returned

#### Scenario: Missing and forbidden projects are indistinguishable

- GIVEN one list request names a missing project and another names a forbidden project
- WHEN project authorization runs
- THEN both return the same permission-safe outcome
- AND neither returns proposal, project, workspace, count, or cursor detail

#### Scenario: Workspace-wide discovery is rejected

- GIVEN a caller requests a workspace or multiple projects
- WHEN proposal list validates scope
- THEN validation fails without executing a broadened query
- AND no workspace proposal count or existence detail is returned

#### Scenario: Unsafe list limit is rejected

- GIVEN a caller requests a limit below 1 or above 50
- WHEN proposal list validates input
- THEN validation fails without executing the query
- AND the limit is not clamped or silently widened

#### Scenario: Cursor is bound and source-safe

- GIVEN a cursor was issued for one project, filter set, authorization context, and list snapshot
- WHEN it is replayed with changed bindings or source/lifecycle changes prevent consistent continuation
- THEN validation, authorization, or source conflict is returned as applicable
- AND the list does not silently restart, skip, duplicate, or reorder rows

#### Scenario: Expired and disposed discovery follows policy

- GIVEN authorized expired proposals and policy-discoverable disposed records exist in project A
- WHEN the viewer explicitly filters `expired` or `disposed`
- THEN effective state is evaluated at the list snapshot
- AND expired content is compact while disposed results contain only allowed disposition metadata
- AND a default current list includes neither state

### Requirement: Typed content is immutable and complete

Every triage proposal MUST have a typed kind and contract version that unambiguously mark it non-executable. Proposal content, as defined above, MUST be immutable after creation. The normalized payload MUST contain only supported, evidence-bearing recommendations using canonical concepts or metadata-only concepts. Every retained recommendation and candidate MUST preserve its evidence, reason, source class, explained `low`, `medium`, or `high` confidence band, and policy/model provenance. Authorization policy version and source seal MUST be retained wherever proposal validity or identity depends on authorization semantics.

The proposal MUST record the effective future approval policy identity/version and risk classification, but MUST NOT expose approval or execution as an action in this slice. Severity, impact, urgency, and SLA MUST remain metadata; duplicate conclusions MUST remain evidence-only. Storage MAY extend an existing proposal representation or use a dedicated representation, but either shape MUST preserve this typed immutable behavior without changing the Issue schema.

#### Scenario: Authorized reader reconstructs the proposal

- GIVEN an authorized viewer reads a proposal
- WHEN its content is returned
- THEN the viewer can identify the target snapshot, normalized recommendations, evidence, confidence basis, policy/model identity, generator, initiator, effective scope, degradation, risk policy, creation time, expiry, retention policy, and trace identity

#### Scenario: Content mutation is rejected

- GIVEN an existing proposal
- WHEN any caller attempts to change its payload, evidence, confidence, provenance, generator, source snapshot, scope, policy/risk metadata, expiry, or retention metadata
- THEN the request fails as an immutable-content conflict
- AND the stored content is unchanged

#### Scenario: Metadata does not become Issue data

- GIVEN a proposal contains severity, SLA, and a duplicate candidate
- WHEN it is created and read
- THEN no Issue field, SLA timer, label, duplicate relation, merge, redirect, closure, dependency, or capacity fact is created

### Requirement: Creation revalidates visibility and source

Persistence MUST re-read and atomically validate the target's current visibility, workspace/project location, source version, source hash, and source seal, plus every retained candidate's current visibility, location, source version/hash, and retained key/text/evidence authorization, before creating or returning a proposal. It MUST bind these checks to the preview's effective scope and authorization policy version. A visible target or retained candidate with changed source, location, policy version, or seal MUST return a source-conflict or authorization-conflict result with safe rerun-preview guidance. A deleted or no-longer-visible target MUST return the permission-safe not-found-or-not-visible outcome; an inaccessible retained candidate MUST reject the entire retained set atomically. No failed validation MAY create a proposal or lifecycle record.

#### Scenario: Source changed after preview

- GIVEN the target changed after its preview
- WHEN persistence presents the older source version or hash
- THEN persistence returns source conflict
- AND no proposal is created

#### Scenario: Target moved projects

- GIVEN the target moved after preview and remains visible to the caller
- WHEN persistence uses the old project scope
- THEN persistence returns source conflict without rewriting scope
- AND no proposal is created

#### Scenario: Target was deleted or became forbidden

- GIVEN the target was deleted or the caller lost visibility after preview
- WHEN persistence is attempted
- THEN it returns the permission-safe not-found-or-not-visible outcome
- AND no proposal, audit lifecycle, or issue event is created

### Requirement: Exact deduplication survives concurrency and retry

The system MUST enforce exact proposal identity with durable database-backed uniqueness and transactional conflict handling, not a process-local check. Concurrent calls, retries, and retries after an unknown commit outcome with the same exact identity MUST return the same proposal identifier and original immutable content and MUST leave exactly one record. This rule applies regardless of whether that record is pending, dismissed, expired, or superseded.

A change to authorization policy version, source seal, scope, target, source version/hash, normalized recommendation payload, or generator identity MUST create a distinct proposal only from a genuinely new preview identity; stale persistence input MUST be rejected. Changes only to initiator, evidence wording, reason wording, confidence, or request time MUST NOT bypass exact dedup; the existing immutable record MUST be returned. Generic legacy `targetRef` deduplication MUST remain separate and MUST NOT be treated as triage exact identity.

#### Scenario: Concurrent identical persistence creates one record

- GIVEN two authorized instances persist the same exact identity concurrently
- WHEN both transactions complete
- THEN both callers receive the same proposal identifier
- AND exactly one triage proposal record exists

#### Scenario: Retry after timeout returns the committed record

- GIVEN a persistence response is lost after commit
- WHEN the caller retries the same exact identity
- THEN the existing proposal is returned
- AND no duplicate lifecycle or creation record is added

#### Scenario: Changed recommendation creates a distinct proposal

- GIVEN an existing proposal
- WHEN a supported recommendation changes so the normalized payload differs
- THEN a distinct proposal is created
- AND it MAY link to the prior proposal as a correction

### Requirement: Validity and explicit dismissal are deterministic and audited

A new proposal MUST begin `pending` with `expiresAt` exactly seven days after creation. At or after `expiresAt`, a pending proposal MUST be read and treated as `expired` even if background disposition has not run. Expiration MUST make it non-current and MUST NOT delete or alter its content.

MCP MUST expose a dismissal capability accepting one proposal ID and a trimmed reason from 1 through 1000 characters. It MUST require member-or-higher project authorization and current target visibility, and MUST atomically dismiss only a pending proposal before expiry. Successful dismissal MUST preserve immutable content and record the original actor, time, reason, client, and correlation identity. It MUST create no Issue change, Issue ActivityLog, domain event, approval, or proposal content change.

`dismissed` and `expired` MUST be idempotent terminal responses. A repeat dismissal of a dismissed proposal MUST return its original terminal state and lifecycle audit without replacing the reason or adding an audit entry. At or after expiry, expiration MUST win; if dismissal commits before expiry it MUST remain dismissed. Concurrent attempts MUST produce one terminal transition and one lifecycle audit, and losing callers MUST receive that terminal result.

#### Scenario: Proposal expires after seven days

- GIVEN a pending proposal reaches its exact expiry time
- WHEN it is read
- THEN lifecycle is `expired` and current is false
- AND immutable content remains readable to an authorized reader
- AND actor, time, and reason identify validity expiration when materialized

#### Scenario: Member dismisses before expiry

- GIVEN an authorized member supplies a bounded non-empty reason before expiry
- WHEN MCP dismissal succeeds
- THEN lifecycle is `dismissed` and current is false
- AND actor, time, reason, client, and correlation identity are recorded without changing content or Issue state

#### Scenario: Invalid dismissal reason is rejected

- GIVEN a member supplies an empty, whitespace-only, or longer-than-1000-character reason
- WHEN MCP dismissal validates the request
- THEN validation fails
- AND no lifecycle, audit, content, Issue, or domain-event change occurs

#### Scenario: Viewer cannot dismiss

- GIVEN a viewer can get and list a proposal
- WHEN the viewer attempts dismissal by proposal ID
- THEN authorization fails with no existence detail beyond the viewer's permitted read
- AND lifecycle, content, audit, Issue state, and domain events are unchanged

#### Scenario: Repeated dismissal is idempotent

- GIVEN a proposal was dismissed with an original actor, time, and reason
- WHEN an authorized caller dismisses it again with the same or a different reason
- THEN the original dismissed response is returned
- AND the original reason remains unchanged
- AND no duplicate lifecycle audit is created

#### Scenario: Dismissal races expiration

- GIVEN dismissal races the proposal expiry time
- WHEN lifecycle is resolved atomically
- THEN a dismissal committed before expiry remains `dismissed`, otherwise the result is `expired`
- AND exactly one terminal transition and lifecycle audit exist

### Requirement: Corrections use explicit supersession

A correction MUST create a distinct immutable proposal whose content contains the prior proposal identifier as `supersedes`. The prior record MUST remain unchanged and readable. Once a valid successor is created, the prior proposal MUST report current false; reverse supersession MAY be derived for authorized readers. A request whose exact identity matches the prior proposal MUST return it and MUST NOT create a self-superseding record.

The proposal schema/migration MUST enforce a database-backed uniqueness invariant on nullable `supersedes` (excluding nulls): each non-null predecessor proposal ID MAY be referenced by at most one successor. Correction creation MUST be serializable or otherwise linearized around this invariant, preserving exact-dedup behavior for identical retries while allowing exactly one winner for distinct concurrent corrections. A losing distinct correction MUST return a typed supersession conflict, create no second successor, and MUST NOT mutate the winner or predecessor.

The required migration/schema/index change MUST enforce this invariant, and concurrency tests MUST prove it with two distinct correction payloads racing against one predecessor, yielding one successor and one typed conflict. This MUST NOT change non-executable status, one-successor lifecycle, source/auth revalidation, immutable content, dedup identity, or legacy behavior.

#### Scenario: Correction preserves history

- GIVEN an authorized member corrects a recommendation with a distinct normalized payload
- WHEN the successor is persisted with `supersedes`
- THEN the successor is a distinct proposal linked to the prior one
- AND the prior content is unchanged and reports non-current

#### Scenario: Exact retry cannot self-supersede

- GIVEN a correction request has the same exact identity as the prior proposal
- WHEN it is persisted
- THEN the prior proposal is returned
- AND no supersession link or new record is created

### Requirement: Retention is configurable, independent, and auditable

Each workspace MUST have a proposal-retention policy with a default duration of one year from proposal creation and a minimum that cannot dispose of a current proposal before its seven-day validity ends. The effective policy identity, version, eligibility time, and duration MUST be captured at creation. A later policy change MUST NOT silently shorten an existing record; any reevaluation that changes its eligibility MUST be explicit and audited.

When retention acts, the system MUST record an observable disposition containing proposal identity, policy identity/version, action, actor or service identity, time, and reason before content becomes unavailable. It MUST NOT silently delete a record. Until disposition, expired and dismissed records MUST remain readable under current target visibility. After disposition, an authorized lookup MUST distinguish policy disposition from a proposal that never existed without exposing content to an unauthorized caller.

#### Scenario: Default retention outlives expiration

- GIVEN no workspace override exists
- WHEN a proposal expires after seven days
- THEN it remains retained under the one-year-from-creation default
- AND expiration does not delete it

#### Scenario: Retention disposition is auditable

- GIVEN a non-current proposal reaches retention eligibility
- WHEN policy disposition occurs
- THEN policy, action, actor/service, time, and reason are recorded before content becomes unavailable
- AND an authorized lookup can identify that retention acted

#### Scenario: Policy change does not silently shorten history

- GIVEN a proposal captured an earlier retention policy
- WHEN workspace policy later changes
- THEN the proposal's eligibility is unchanged unless an explicit audited reevaluation occurs

### Requirement: Degraded previews persist only supported content

Persistence MAY accept a degraded preview only when at least one retained recommendation or candidate conclusion is supported by item-specific evidence. Unknown and conflicting items MAY be retained as context but MUST NOT become normalized actions. The proposal MUST preserve all preview completeness and degradation markers and MUST NOT claim unavailable AI, candidate search, or optional context ran successfully. A preview with no supported evidence-bearing item MUST fail validation and create no proposal.

#### Scenario: Deterministic subset is persisted after AI timeout

- GIVEN a preview has supported deterministic recommendations and `ai_timed_out`
- WHEN a member persists the supported subset
- THEN the proposal retains `ai_timed_out`
- AND only supported evidence-bearing items enter the normalized payload

#### Scenario: Unsupported degraded preview is rejected

- GIVEN every result is unknown, conflicting, or lacks evidence
- WHEN persistence is attempted
- THEN validation fails
- AND no proposal is created

### Requirement: Triage proposals cannot be applied

No API, MCP tool, lifecycle transition, or legacy proposal route MAY approve, apply, execute, or mark a triage proposal `applied`. Legacy apply ID resolution MUST query the dedicated triage ledger first. If the ID is found there, target authorization MUST run before any result is disclosed: a missing or invisible target returns the same not-found-or-not-visible outcome, never falls through, and reveals no triage existence. For an authorized triage ID, the system MUST record the rejected non-executable attempt before any legacy lookup or status operation; if that audit cannot be recorded, it MUST fail closed and perform neither lookup/status nor domain mutation. Only actual absence from the triage ledger may enter unchanged legacy lookup/status. Compatible legacy proposal rows MUST remain readable, and legacy status-only apply behavior MAY remain unchanged for legacy kinds.

#### Scenario: Legacy apply rejects triage kind

- GIVEN a pending triage proposal
- WHEN `kanon_apply_proposal` or the legacy apply API receives its identifier
- THEN the call fails as unsupported and non-executable
- AND lifecycle remains pending or expires normally
- AND no issue, status, ActivityLog, approval, or domain event changes

#### Scenario: Legacy proposal compatibility is preserved

- GIVEN a compatible legacy proposal created before this change
- WHEN it is read or sent through its established legacy apply path
- THEN its established data and behavior remain available
- AND it does not collide with triage exact deduplication

### Requirement: Proposal reads reauthorize and redact retained candidates

Get and every list-page evaluation MUST reauthorize the target and every retained candidate against current visibility, project/token scope, source authorization, and authorization policy version. If the target is inaccessible, the proposal result MUST be indistinguishable from absence. If a retained candidate is inaccessible, read-time projection MUST redact its key, text, and evidence without exposing a candidate existence marker, inaccessible-candidate count, omission count, or other cardinality signal; immutable stored bytes MUST remain unchanged.

Redaction is a read projection only and MUST NOT rewrite proposal content, lifecycle, audit, deduplication identity, source seal, or supersession links. Authorized candidate data MUST still satisfy the same bounded projection and evidence rules, and disposed content MUST remain unavailable.

#### Scenario: Inaccessible candidate is redacted without a signal

- GIVEN the target remains visible but a retained candidate becomes inaccessible
- WHEN an authorized reader gets the proposal
- THEN the candidate's key, text, and evidence are absent from the projection
- AND no inaccessible-candidate existence or count signal is returned
- AND the immutable stored bytes remain unchanged

#### Scenario: Target authorization still gates the record

- GIVEN a reader loses visibility to the target issue
- WHEN the reader gets or lists the proposal
- THEN the result is the same permission-safe outcome as a missing proposal
- AND no candidate or proposal content is disclosed

### Requirement: Proposal audit and observability preserve privacy

Prepare/validate, creation, dedup return, source or supersession conflict, authorization failure, get, list page, dismissal, expiration, retention disposition, and rejected apply MUST carry a correlation or trace identity. Persisted proposal provenance MUST identify initiator/client, generator, policy identity/version, authorization policy version, model identity when used, source version/hash/snapshot and seal, effective scope, evidence/confidence, degradation, creation time, and trace identity. Lifecycle audit MUST identify actor, time, and reason.

Operational metrics MUST measure prepare/validate and persistence latency, AI degradation, created-versus-deduplicated outcomes, source/supersession conflicts, get/list/dismiss/expiry/retention outcomes, returned-row counts, and rejected apply attempts using non-sensitive low-cardinality labels. Metrics and permission-denied responses MUST NOT expose query or body text, evidence, cursor, model, proposal, issue, project, workspace, or other domain identifiers, or hidden-resource cardinality; model identity MAY appear in controlled traces/audit only.

#### Scenario: Deduplicated retry is traceable

- GIVEN a retry returns an existing proposal
- WHEN telemetry and authorized audit are inspected
- THEN the request trace identifies a deduplicated outcome and the proposal's creation provenance remains unchanged
- AND metrics contain no proposal or issue identifier labels

#### Scenario: Rejected apply is observable without mutation

- GIVEN legacy apply rejects a triage proposal
- WHEN authorized audit and metrics are inspected
- THEN the attempt, actor/client, time, reason, and correlation identity are observable
- AND proposal content and lifecycle are unchanged

### Requirement: Rollout gates and dedicated-ledger recovery are objective

The triage flags MUST remain off until every required build, generation, test, security, concurrency, and performance check is green: 100% of required assertions must pass, not a pass-rate substitute. Canary exposure MUST be operator-approved and measured per stage in rolling five-minute windows with at least 100 completed requests. Unexpected stage errors above 1% MUST page the owner and disable that stage; typed degradation above 10% MUST page the owner and halt canary exposure for that stage.

Unexpected errors above 5% MUST page incident command and disable all triage flags. Any security or invariant violation MUST immediately disable all flags. Reference-load preview P95 MUST remain under three seconds as a separate gate. Threshold actions MUST only page or disable exposure; they MUST NOT mutate issues, proposal content, or audit history.

Rollback MUST be flag-off first while retaining ledger rows and audit. Recovery MUST be fix-forward through the dedicated triage ledger: repair forward, verify the retained rows/audit and all required checks, then re-enable only after a new operator-approved canary. No destructive down-migration, legacy-apply bypass, or audit erasure is allowed during recovery.

### Requirement: First-slice boundaries remain intact

This delivery MUST NOT add Issue schema fields or migration, duplicate relation or merge behavior, proposal approval or execution, capacity inference, bulk or asynchronous triage, issue-dependency behavior, a web triage UI, a Kanon-hosted model, external integrations, or a durable operation queue. The existing `packages/shared` MAY carry the versioned contract only if used as the API/MCP schema boundary and MUST NOT gain unrelated domain behavior.

#### Scenario: Domain and data boundaries are unchanged

- GIVEN the completed first slice
- WHEN its persisted schema and exposed triage behaviors are inspected
- THEN Issue fields are unchanged
- AND only proposal-specific immutable content and lifecycle/audit persistence were added
- AND no duplicate, dependency, capacity, SLA timer, approval, execution, batch-job, integration, or durable-queue record is created

#### Scenario: Product surfaces remain bounded

- GIVEN the completed first slice
- WHEN user-facing surfaces are inventoried
- THEN bounded search, read-only preview, and explicit proposal persist/get/project-list/dismiss capabilities are present
- AND no workspace-wide proposal list, web UI, hosted model, bulk triage, merge, approval, or apply surface was added

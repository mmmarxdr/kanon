# Triage Preview Specification

## Purpose

Provide a compact, explainable, single-issue triage preview that separates authoritative Kanon policy from optional host-AI judgment and never persists a triage decision.

## Terms

- **Evidence** is a bounded, caller-visible source reference containing a source class, visible issue or policy reference, field/location, observed source version when applicable, and either a bounded excerpt or deterministic fact. A fluent rationale without such a reference is not evidence.
- **Confidence** is an explained band, never a probability: `low` means evidence is weak, incomplete, or materially conflicting; `medium` means evidence supports the result but meaningful ambiguity remains; `high` means direct deterministic evidence or multiple corroborating sources support the result with no known material conflict. Every band includes a textual basis and never overrides policy.
- **Recommendation source** is `deterministic_policy` or `host_ai`. Deterministic output identifies the policy and rule version. Host-AI output additionally identifies provider, model, and model version.
- **Recommendation state** is `supported`, `unknown`, or `conflict`. `unknown` means required evidence or context is unavailable. `conflict` means visible supported signals disagree and the preview does not resolve them silently.
- **Normalized recommendation** is a versioned, typed recommendation for an existing canonical concept (`type`, `priority`, `labels`, `group`, `assignee`, or `cycle`) or metadata-only concept (`severity`, `impact`, `urgency`, or `sla`). A duplicate candidate is evidence-only, not a duplicate action.
- **Authorization policy version** is the immutable version of the authorization semantics used for target/candidate visibility and effective scope. Any preview identity, source seal, persistence token, or continuation cursor whose validity depends on authorization MUST bind this version.
- **Preview identity** identifies one newly executed preview and its exact target, source, authorization, and normalized-input context. A **source seal** is an opaque, canonical seal over that context, including the authorization policy version and source snapshot.

## Requirements

### Requirement: Single visible issue and read-only execution

A preview MUST accept exactly one target issue that the caller may view. It MUST observe a bounded source snapshot and return its workspace, project, stable issue reference, source version, source hash, and observation time. A persistence-eligible preview MUST also issue an opaque preview identity and source seal bound to the target snapshot, retained candidate snapshot, effective authorized scope, authorization policy version, contract version, and search/ranking policy versions. A missing and a non-visible target MUST produce a permission-safe not-found-or-not-visible outcome with no target details.

Preview execution MUST create zero Issue changes, proposal records, ActivityLog entries, proposal lifecycle records, domain events, duplicate relations, comments, notifications, work records, or other business-domain writes. Normal access logs, traces, and aggregate operational metrics MAY be recorded, but MUST NOT be represented as a persisted triage decision.

#### Scenario: Authorized preview reads one issue

- GIVEN a caller may view the target issue
- WHEN the caller requests a preview
- THEN exactly one target snapshot is evaluated
- AND the result includes its source version, source hash, and observation time

#### Scenario: Missing and forbidden targets are indistinguishable

- GIVEN one request names a missing issue and another names an issue the caller cannot view
- WHEN preview authorization is evaluated
- THEN both return the same semantic not-found-or-not-visible category
- AND neither returns issue, project, workspace, count, or candidate details

#### Scenario: Repeated preview has no hidden writes

- GIVEN snapshots of Issue, proposal, ActivityLog, lifecycle, event, relation, comment, and notification state
- WHEN preview is called repeatedly, including with AI input and degraded dependencies
- THEN those domain snapshots are unchanged
- AND no triage proposal identifier is returned

### Requirement: Typed explainable preview contract

Every preview MUST identify its contract version, target snapshot, effective authorized search scope, authorization policy version, search completeness, correlation or trace identity, preview identity, source seal, policy identity and version, generation time, recommendations, ranked duplicate candidates, conflicts, unknowns, and degradation reasons.

Every supported recommendation MUST include a stable item identifier, normalized recommendation, source class, reason, at least one item-specific evidence reference, confidence band, and confidence basis. Every duplicate candidate MUST include stable issue reference, rank, candidate source version and hash, source class, reason, at least one item-specific evidence reference, confidence band, and confidence basis. Host-AI items MUST additionally include provider, model, and model version. Numeric confidence or probability MUST NOT be emitted in this slice.

#### Scenario: Deterministic recommendation is reconstructable

- GIVEN a deterministic policy recommends a priority
- WHEN preview returns the recommendation
- THEN it includes the normalized priority value, policy source class, policy and rule version, reason, evidence, and explained confidence band
- AND an authorized reviewer can identify the observed source supporting it

#### Scenario: AI recommendation carries model provenance

- GIVEN validated host AI contributes an assignee recommendation
- WHEN preview returns the recommendation
- THEN it includes provider, model, model version, reason, evidence, and explained `low`, `medium`, or `high` confidence
- AND it remains distinguishable from deterministic policy output

#### Scenario: Unsupported fluent claim is not accepted

- GIVEN host AI returns a plausible recommendation without item-specific evidence or model version
- WHEN Kanon validates it
- THEN the item is omitted or returned as `unknown` with a validation finding
- AND it is not returned as `supported`

#### Scenario: Candidate explanation is complete

- GIVEN duplicate candidates are returned
- WHEN the caller inspects each candidate
- THEN every candidate has a unique rank from 1 through the returned candidate count
- AND every candidate has evidence, reason, source class, explained confidence band, source version, and source hash

### Requirement: Deterministic policy is authoritative and repeatable

For an unchanged source snapshot, authorization policy version, policy/rule version, authorized context, and normalized inputs, deterministic findings and their ordering MUST be stable. Host-AI suggestions MUST be validated against the typed contract, authorization boundary, canonical values, and deterministic policy. Host AI MUST NOT expand scope, waive permission checks, change source versions, invoke tools, or convert metadata-only concepts into Issue fields.

A host-AI suggestion that violates policy or lacks support MUST NOT become a supported recommendation. When a policy-valid AI suggestion and another supported signal disagree, the preview MUST return `conflict` with both visible evidence sets rather than choosing one silently.

#### Scenario: Deterministic retry is stable

- GIVEN source, policy, authorized context, and inputs are unchanged
- WHEN preview is retried
- THEN deterministic findings, reasons, evidence references, confidence bands, and ordering are identical

#### Scenario: AI cannot override policy

- GIVEN host AI suggests an assignee outside the authorized project or an invalid cycle
- WHEN Kanon validates the suggestion
- THEN the suggestion is rejected or marked unsupported
- AND no policy, authorization, or canonical-value rule is bypassed

#### Scenario: Conflicting supported signals remain explicit

- GIVEN deterministic evidence supports group A
- AND policy-valid AI evidence supports group B
- WHEN neither signal can authoritatively resolve the other
- THEN the recommendation state is `conflict`
- AND both evidence sets and sources are returned
- AND neither group is represented as an accepted action

### Requirement: Issue content is an untrusted prompt-injection boundary

Issue titles, descriptions, comments, labels, and candidate text MUST be treated only as quoted untrusted evidence. Instructions embedded in issue content MUST NOT change authorization scope, projection, policy, output tier, model identity, tool selection, or write behavior. Host-AI output MUST be treated as untrusted input and validated before inclusion.

The preview MUST NOT execute a tool or network action requested by issue content or model output. Invalid injected instructions MUST be ignored and MAY produce a safe validation finding without echoing secret or forbidden content.

#### Scenario: Issue text requests a hidden workspace search

- GIVEN the target description instructs the model to search another workspace and reveal counts
- WHEN preview runs in project scope
- THEN scope remains the authorized target project
- AND no hidden workspace data, count, or existence signal is returned

#### Scenario: Issue text requests mutation

- GIVEN issue text asks the model to assign, close, merge, comment on, or persist the issue
- WHEN preview runs
- THEN no requested tool or mutation is invoked
- AND the result remains a read-only recommendation

#### Scenario: Model output contains an unsupported action

- GIVEN host-AI output asks to invoke a tool or emits an action outside the versioned contract
- WHEN output is validated
- THEN that content is rejected
- AND supported deterministic output remains available

### Requirement: Candidate ranking is bounded and permission-safe

Preview MUST use the bounded issue search contract and MUST return no more than 10 duplicate candidates total. Project scope MUST be the default. Workspace expansion MUST be explicit and authorized. Candidate ranking MUST exclude the target issue and MUST consider only authorized rows before ranking. Candidate keys, text, and evidence MUST be permission-safe at preview time and MUST be treated as retained content requiring reauthorization during persistence and every later proposal read. A candidate result MUST remain evidence-only: it MUST NOT create a duplicate relation, merge, redirect, close, reparent, or modify either issue.

Search completeness and degradation MUST be preserved in the preview. A timed-out or degraded candidate search MUST NOT be described as an exhaustive duplicate check.

#### Scenario: Candidate maximum applies across a workspace

- GIVEN authorized workspace expansion covers several projects
- WHEN more than 10 candidate issues match
- THEN at most 10 candidates are returned across the entire request
- AND search completeness is `bounded`

#### Scenario: Forbidden candidate has no observable influence

- GIVEN an inaccessible issue would otherwise rank first
- WHEN preview ranks candidates
- THEN that issue is absent
- AND authorized candidate ranks, completeness, and counts are the same as if the inaccessible issue did not exist

#### Scenario: Candidate timeout is explicit

- GIVEN candidate retrieval exceeds its deadline
- WHEN a trustworthy partial set is available
- THEN the preview returns that bounded set with `timed_out` completeness and a degradation reason
- AND it does not claim the set is exhaustive

#### Scenario: Candidate recommendation creates no relation

- GIVEN a candidate is returned with high confidence
- WHEN preview completes
- THEN neither target nor candidate is changed
- AND no duplicate relation, merge, redirect, closure, or domain event exists

### Requirement: Preview persistence handoff is fail-closed

Persistence MUST reauthorize the target and every retained candidate against current target/candidate visibility, project and token scope, source version/hash, source seal, and authorization policy version. A changed, deleted, moved, or inaccessible retained candidate key, text, or evidence MUST reject the entire retained set atomically; it MUST NOT omit the candidate or reveal an existence or count signal.

A stale source seal, authorization policy version, or preview identity MUST be rejected as source conflict or authorization conflict. A genuinely new preview run after source or policy change MUST receive a new preview identity and source seal and MAY produce a distinct proposal; persistence MUST never silently reinterpret stale input as a new preview.

#### Scenario: Retained candidate loses access

- GIVEN a preview retained a visible candidate and the caller later loses candidate visibility
- WHEN the caller persists the preview
- THEN persistence rejects the entire retained set atomically
- AND it reveals no candidate existence, key, text, evidence, or count

#### Scenario: New preview is distinct from stale input

- GIVEN a source seal or authorization policy version changed after preview
- WHEN the caller persists the old preview and then runs a new preview
- THEN the old preview is rejected without a proposal
- AND the new preview has a new identity and seal rather than mutating or reusing the old input

### Requirement: Unknowns, conflicts, and degradation are honest

The preview MUST return `unknown` rather than infer a value when required optional context is unavailable. It MUST identify the affected recommendation, missing context class, and safe reason. It MUST NOT infer assignment capacity from active work sessions or cycle membership.

If host AI is unavailable, invalid, or late, the preview MUST return the supported deterministic subset within the request budget and identify `ai_unavailable`, `ai_invalid`, or `ai_timed_out` as applicable. The system MUST NOT silently switch provider or model. If deterministic policy or target-source validation cannot produce a trustworthy result, the request MUST fail with temporary unavailability or source conflict rather than return fabricated recommendations.

#### Scenario: Optional ownership context is missing

- GIVEN declared ownership context cannot be read
- WHEN assignment is evaluated
- THEN the assignment result is `unknown`
- AND the missing context and affected item are identified
- AND active workers are not presented as capacity evidence

#### Scenario: AI misses the deadline

- GIVEN deterministic policy completes but host AI does not complete in budget
- WHEN preview returns
- THEN deterministic results are returned
- AND degradation includes `ai_timed_out`
- AND no substitute model identity or AI recommendation is invented

#### Scenario: Core deterministic context is unavailable

- GIVEN target source validation cannot establish a trustworthy source snapshot
- WHEN preview runs
- THEN the request fails with source conflict or temporary unavailability
- AND no unsupported preview is labeled complete

### Requirement: Metadata recommendations do not create domain fields

Severity, impact, urgency, and SLA MUST be represented only as typed recommendation or proposal metadata. Type, priority, labels, group, assignee, and cycle MAY be recommended as canonical actions, but preview MUST NOT apply them. Duplicate conclusions MUST remain ranked evidence. The preview MUST NOT assert capacity, dependencies, external-provider state, or hosted-model output that the slice does not possess.

#### Scenario: SLA recommendation remains metadata

- GIVEN preview returns an SLA recommendation
- WHEN the target issue is read after preview
- THEN no SLA field, timer, escalation, label, or Issue schema-backed value was created
- AND the recommendation is explicitly marked metadata-only

#### Scenario: Assignment describes fit, not capacity

- GIVEN evidence supports declared ownership by a member
- WHEN preview recommends that member
- THEN the reason describes fit or ownership
- AND it does not claim available capacity unless an authorized capacity source exists, which is outside this slice

### Requirement: First-slice preview boundaries remain intact

Preview MUST remain read-only and bounded and MUST NOT add autonomous apply or approval, duplicate merge or close, Issue schema migration, web UI, bulk or asynchronous triage, capacity or dependency work, a hosted model, or external integrations. It MUST preserve the existing issue and MCP contracts and MUST NOT create a durable operation queue.

### Requirement: Latency and output are bounded

The versioned synthetic regression fixture MUST use a P95 target below 3 seconds for one target and up to 10 candidates. It MUST exercise the maximum-candidate path and document its generated corpus, repeated-sample mode, scope, and whether host-AI input is present. This threshold catches fixture regressions only; it does not certify live PostgreSQL/API latency. Optional AI MUST NOT extend the deadline.

The MCP preview MUST support `compact` and explicit `full` output tiers. `compact` MUST be the default, MUST contain all mandatory decision and provenance fields, MUST exclude full descriptions, and MUST serialize to no more than 16 KiB with 10 candidates. `full` MUST remain server-bounded and permission-filtered; it MAY add bounded validation and snapshot detail but MUST NOT make evidence, candidate count, description, identity, or authorization scope unbounded. If an output budget prevents inclusion, the system MUST omit the lowest-priority optional detail and report output degradation; it MUST NOT drop mandatory evidence from a returned supported item.

#### Scenario: Synthetic preview fixture meets its P95 regression budget

- GIVEN the versioned synthetic preview fixture
- WHEN repeated fixture samples are measured to calculate P95
- THEN fixture P95 is less than 3 seconds without claiming live certification
- AND AI timeout samples return deterministic degradation inside the same budget

#### Scenario: Compact maximum remains within budget

- GIVEN 10 candidates and the maximum supported compact recommendation set
- WHEN the response is serialized
- THEN its size is no more than 16 KiB
- AND all returned supported items retain mandatory evidence and provenance
- AND full descriptions are absent

#### Scenario: Full tier remains bounded

- GIVEN the caller explicitly requests `full`
- WHEN diagnostic details are returned
- THEN all fields remain authorized and server-bounded
- AND candidate and evidence limits are unchanged
- AND any omitted optional detail is identified as output degradation

### Requirement: MCP capabilities remain discoverable and compatible

Exactly five new MCP tools MUST be separately discoverable for preview, proposal persistence, proposal get, project-scoped proposal list, and proposal dismissal. All five MUST be deferred/on-demand. Names, descriptions, and write annotations MUST identify preview/get/list as read-only, persistence as proposal creation, and dismissal as a proposal-lifecycle write; none MAY advertise approval, apply, execution, Issue mutation, workspace-wide proposal listing, or autonomous triage.

All 44 pre-existing tools MUST remain registered with their established contracts. Final inventory MUST be exactly 49 tools: 26 core and 23 deferred. The fixed startup description and instruction ceilings MUST remain unchanged, so descriptions/instructions MUST receive compensating trims without removing tools or changing behavior. Runtime registration, exact-count tests, deferred classification, instructions, description-budget fixtures, and inventory documentation MUST all agree on 49/26/23.

Every new MCP result or error MUST preserve contract version, provenance, semantic error category, correlation identity, and safe retry guidance when applicable. Semantic categories MUST distinguish validation, not-found-or-not-visible, authorization, source conflict, terminal lifecycle, temporary unavailability, and degraded success without inventing a successful empty result.

#### Scenario: All five tools are discovered with safe intent

- GIVEN an MCP client performs deferred tool discovery
- WHEN it inspects the new triage/proposal capabilities
- THEN preview, persist, get, project-list, and dismiss are each discoverable
- AND preview/get/list are read-only while persist/dismiss are explicit writes
- AND none is described as apply, execution, Issue mutation, or workspace-wide listing

#### Scenario: Proposal writes cannot be mistaken for reads or apply

- GIVEN an MCP client compares the five names, descriptions, and annotations
- WHEN it selects a capability
- THEN only persist is described as creating immutable proposal content
- AND only dismiss is described as changing lifecycle
- AND no capability claims to approve or execute a proposal

#### Scenario: Exact MCP inventory remains compatible and within budget

- GIVEN 44 existing tools comprised 26 core and 18 deferred
- WHEN five deferred tools are added
- THEN all existing contracts remain available
- AND runtime, tests, instructions, fixtures, and documentation report exactly 49 total, 26 core, and 23 deferred
- AND compensating description/instruction trims keep both fixed ceilings unchanged

### Requirement: Preview diagnostics preserve privacy without dedicated telemetry

Prepare/validate and MCP responses MUST retain their existing request correlation identity. The response contract MUST expose typed completeness, degradation, validation rejection, and error outcomes without requiring dedicated triage metrics, counters, stage traces, or alerts.

Existing platform logs MUST apply existing authorization and redaction controls and MUST NOT add query or body text, evidence, cursor, model, user, issue, project, workspace, other domain identifiers, or forbidden-resource cardinality for triage diagnostics. Standard request logging MUST NOT create an ActivityLog or persisted triage decision.

#### Scenario: Degraded preview is observable

- GIVEN host AI times out after deterministic policy completes
- WHEN preview returns
- THEN the response reports the typed `ai_timed_out` degradation outcome
- AND no prompt, evidence text, or domain identifier is added to platform logs for triage diagnostics

#### Scenario: Request logging does not become a domain write

- GIVEN preview emits standard platform access logs
- WHEN domain state is inspected
- THEN no proposal, ActivityLog, lifecycle entry, or domain event was created

### Requirement: Preview remains disabled without an enablement gate

`TRIAGE_PREVIEW_ENABLED` MUST remain false by default. This change defines no dedicated triage telemetry gate, live canary, or production certification process, so it does not authorize enablement.

The named performance profiles are synthetic regression fixtures only. They do not exercise a live PostgreSQL/API deployment and MUST NOT be treated as certification evidence. Rollback remains flag-off first, retains preview/proposal data, dedicated triage-ledger rows, and audit, and fixes forward.

# Make MCP triage safe and usable for large teams

## Executive decision

Deliver one coherent first slice: **bounded server-side issue retrieval, an explainable read-only triage preview, and a separate explicit action that persists an immutable typed proposal**.

This gives triagers, PMs, engineering leads, members, and auditors useful AI-assisted triage without allowing an agent to silently change issues. Kanon owns deterministic validation, authorization, and policy. A host agent or model may make ambiguous suggestions, but every such suggestion must identify its evidence, confidence, and model/provider/version. The slice does not apply or execute proposals.

The broader enterprise roadmap remains follow-up work. In particular, this change does not implement proposal execution, issue-dependency exposure, duplicate consolidation, capacity or portfolio planning, bulk asynchronous triage, first-class SLA/domain fields, external integrations, or durable operation infrastructure.

## Intent

Large teams need to assess an incoming issue quickly without loading an entire project queue, leaking inaccessible issues, or trusting an unexplained model judgment. Today, Kanon's MCP can compose small-team issue workflows, but issue pagination is local after a full API fetch, search and projection are not exposed as bounded server-side primitives, and the existing proposal mechanism is free-form and has a status-only `apply` action that does not execute its payload.

The intent is to create a trustworthy first triage workflow:

1. A user requests a preview for one issue.
2. Kanon retrieves no more than 10 permission-safe candidates through bounded server-side search and projection.
3. Kanon returns deterministic policy findings and validates any host-AI suggestions.
4. The preview explains every recommendation and candidate rank and makes degradation visible.
5. Nothing is persisted until the caller explicitly asks to persist the preview as a proposal.
6. The resulting proposal is immutable, deduplicated, auditable, and not executable in this slice.

### User-visible win

A triager can inspect one ambiguous issue and receive a compact, explainable result in under three seconds, including up to 10 possible duplicates and recommendations that are clearly separated into deterministic and AI-assisted judgments. If the result is worth retaining, a project member can explicitly persist it for later review. A viewer or auditor with issue access can reconstruct what was proposed, from which source state, by which policy/model, and with what evidence—without any issue being changed.

## Business problem and affected personas

Large queues turn the current client-side listing and ad hoc agent workflow into operational cost and trust risk. Users wait on full-project fetches, spend context on irrelevant issue fields, manually repeat candidate searches, and cannot distinguish Kanon-enforced policy from a model's inference. The existing generic proposal row is not sufficient as a durable triage decision record, while its `apply` name can misleadingly imply execution.

| Persona | Situation and pain today | Outcome from this slice |
|---|---|---|
| Triager | Reviews a high-volume intake queue and repeatedly searches, opens, and compares issues. | Gets one bounded, compact preview with ranked candidates, recommendations, evidence, and explicit uncertainty. |
| PM | Needs consistent prioritization/routing guidance and a reviewable record without accidental mutation. | Can inspect policy-aware recommendations and explicitly persist an immutable proposal. |
| Engineering lead | Evaluates likely ownership, cycle placement, priority, or duplicate risk while balancing incomplete context. | Sees what is known, inferred, unavailable, and approval-sensitive before making a separate human decision. |
| Member | Wants AI assistance but should not silently alter shared planning commitments. | May preview and persist a proposal when authorized, but cannot apply it through this workflow. |
| Auditor/viewer | Must explain who or what recommended a decision and whether unauthorized data influenced it. | Can read proposals allowed by issue/project access, including source snapshot, evidence, confidence, policy/model identity, lifecycle history, and degradation markers. |

## Current-state gap

The authoritative exploration found 44 registered MCP tools (26 core and 18 deferred) and four P0 gaps relevant to large teams:

- `kanon_list_issues` applies `limit` and `offset` locally after the API returns the full matching project list. MCP does not expose the API's existing `q` search, and neither surface offers the bounded projection/cursor contract needed for queue-scale triage.
- There is no normalized, explainable triage recommendation contract. Agents can call existing reads and then mutate issues directly, but evidence, confidence, policy version, model identity, and degradation are ad hoc.
- `McpProposal` stores a free-form payload. Its current partial unique index deduplicates only pending generic proposals by workspace and `targetRef`, not by the approved exact triage identity.
- `kanon_apply_proposal` and `POST /api/proposals/:id/apply` only mark a proposal `applied`; they do not execute the payload. A new triage record must not be routed into that legacy status-only behavior.

Issue dependencies are also a P0 enterprise gap, but they are not required to make this first triage slice usable and are intentionally deferred.

## Approved proposal assumptions

The interactive proposal round resolved the remaining product workflow rules:

- Preview and persistence are separate actions. Preview is strictly read-only; persistence requires an explicit caller action.
- Project members and above may persist proposals. Visibility follows issue/project access. Viewers and auditors may read but not create.
- Proposal payload, evidence, confidence, provenance, and source snapshot are immutable. Lifecycle status may change to `dismissed` or `expired`.
- There is no triage apply action or `applied` lifecycle state in this slice. A correction creates a new proposal linked to the proposal it supersedes.
- Exact deduplication identity is workspace/project scope + target issue + source seal/version + normalized action payload + generator identity + validated host-outcome digest. A repeat returns the existing proposal; a changed source or recommendation from a new preview creates a new one.

Other settled decisions are incorporated below and are not open for reconsideration.

## Goals

1. Replace full-fetch/local-slice behavior for this workflow with reusable, bounded server-side issue search and field projection.
2. Provide a single-issue, read-only triage preview with deterministic policy findings, typed recommendations, duplicate candidate ranking, evidence, confidence, and provenance.
3. Support project scope by default and explicit, permission-checked workspace expansion, with a strict maximum of 10 candidates across the whole request.
4. Persist an immutable, typed proposal only through a separate explicit action, with exact concurrent-safe deduplication and lifecycle auditability.
5. Preserve current issue data and existing MCP tools while preventing triage proposals from being accidentally marked applied by the legacy status-only route/tool.
6. Keep MCP startup descriptions and compact output within explicit budgets, and return useful deterministic results when AI or optional context is unavailable.
7. Establish a proposal/action envelope that a later execution phase can validate and apply without redesigning the triage record.

## Product principles

- **Read before write.** Preview has zero domain writes. Persistence is separately named and explicitly invoked.
- **Bounded by default.** Search, projection, candidates, evidence snippets, latency, and output size have server-enforced limits.
- **Policy is authoritative; AI is advisory.** Kanon owns permissions, invariants, validation, and deterministic policy. Host AI may suggest ambiguous classifications but cannot override policy.
- **Evidence over fluency.** Unsupported claims become `unknown` or are omitted; confident prose is not evidence.
- **Fail closed on authorization.** Search totals, candidate data, and proposal visibility are computed only after effective workspace/project/token scope is enforced.
- **No triage god-tool.** The workflow composes reusable search, recommendation, proposal, and eventual action primitives rather than introducing an autonomous mutation surface.
- **Additive compatibility.** Existing MCP tools and legacy proposal records remain available; new triage records are explicitly versioned/typed and non-executable.
- **Model domain concepts deliberately.** Severity, impact, urgency, and SLA may be recommended as proposal metadata now, but do not become Issue fields or improvised labels in this slice.

## Scope: first delivery

### 1. Foundation required now

#### Bounded server-side issue search and projection

Add an API-level retrieval primitive usable by MCP and future product surfaces that:

- searches a single project by default;
- expands to the visible target issue's workspace only when explicitly requested and authorized by current `viewer+` project memberships (the existing role hierarchy at or above `viewer`) intersected with token projects; no special hidden role;
- applies search, filters, authorization, stable ranking/sort, projection, and limit before returning rows;
- returns at most 10 candidate issues for triage, total rather than per project;
- does not fetch a full project/workspace issue collection merely to slice it in MCP;
- exposes enough source identity/version information to detect stale previews and proposals;
- defaults to a compact projection and never includes full descriptions or unrelated identity data unless an allowed projection requires them;
- reports the effective authorized scope and whether the candidate set is complete, bounded, timed out, or degraded without revealing forbidden-project existence or counts.

This is a reusable primitive, not a triage-only local filter. Existing `kanon_list_issues` inputs and outputs remain compatible; implementation may reuse the new server-side primitive without changing established caller semantics.

#### Typed recommendation and proposal/action contract

Define a versioned contract that can represent:

- target workspace, project, issue, source version/hash, and observed snapshot;
- normalized proposed actions for existing canonical concepts such as type, priority, labels, group, assignee, and cycle;
- recommendation-only metadata for severity, impact, urgency, and SLA, with no Issue schema write;
- ranked duplicate candidates with evidence only;
- deterministic policy findings and policy version;
- per-recommendation evidence, confidence, source class, and reason;
- host model/provider/version identity whenever AI contributed;
- server-derived authenticated initiator and client provenance, creation time, effective search scope, trace/correlation identity, degradation flags, and a digest of the validated host outcome; host model/provider/version is caller-reported, shape-validated, and never authorization authority;
- effective approval sensitivity/policy metadata for future use;
- supersession and expiration metadata;
- a canonical normalized identity (`triage-c14n.v1`: sorted object keys and set fields, NFKC strings, and explicit null/absence/set/clear semantics) suitable for exact deduplication.

Kanon deterministically prepares and validates policy and the contract; host AI may be nondeterministic, but validated suggestions are bound to source, model, evidence, and a validated host-outcome digest included in persistence identity without implying model attestation. Issue text is untrusted evidence, never an instruction source or permission to invoke tools.

### 2. First user-facing capability: triage preview

The preview operates on one visible issue and is strictly read-only:

- It returns deterministic validation/policy results and only the first bounded candidate page (maximum 10); a reusable search cursor never lets one preview accumulate pages.
- Kanon deterministically prepares policy findings and deterministically ranks/orders the bounded candidate set; host AI may annotate or explain those candidates and may be nondeterministic for ambiguous classification, routing, or summarization, but cannot add, remove, or reorder them. Only evidence-bearing, source/model-bound validated suggestions may enter the preview.
- Duplicate handling stops at candidate ranking. It does not create a relation, merge, redirect, close, or modify either issue.
- Severity, impact, urgency, and SLA appear only as recommendation/proposal metadata. There is no Issue schema migration, SLA clock, escalation, or reporting field.
- Assignment recommendations describe fit or declared ownership, not capacity; current work sessions and cycle membership are not treated as a capacity model.
- The response distinguishes policy output, AI output, missing context, unsupported recommendations, and conflicting signals.
- If AI is unavailable or misses the deadline, the preview returns deterministic-only output with an explicit degradation reason. If optional context is unavailable, affected recommendations become `unknown` rather than inferred.
- Preview produces no Issue, proposal, ActivityLog, lifecycle, event, or other business-domain write. Normal access logs and aggregate operational metrics are allowed but must not be presented as a persisted triage decision.

### 3. Explicit immutable proposal persistence

A separate persistence action converts an eligible preview into a durable proposal:

- Only a project member or higher role with current authorization may persist. Viewer/auditor access is read-only and follows target and candidate visibility boundaries.
- Persistence reauthorizes the target and every retained candidate against current project/token scope and source version, and accepts only when the preview's source seal and source snapshot equal current state. Any mismatch rejects with source conflict and creates no row; a newly run preview after change has a new current seal/source and may create a distinct proposal. A changed/deleted/moved target or any inaccessible retained candidate reference/text/evidence rejects the entire retained set atomically rather than omitting data.
- Proposal reads reauthorize the target and each retained candidate; inaccessible candidate keys, text, and evidence are redacted with no count/existence signal as read-time projection only, while immutable stored content remains intact.
- Payload, actions, evidence, confidence, policy/model provenance, source snapshot, generator identity, and scope are immutable after creation.
- Only lifecycle metadata may change: pending may become dismissed or expired, with actor/time/reason recorded. No triage proposal may become applied in this slice.
- A correction creates a new immutable proposal linked to the superseded record; it does not edit the old payload.
- Concurrent or retried persistence with the exact approved identity returns the same proposal ID and creates no duplicate row.
- A changed source seal/version or normalized action payload, generator identity, workspace/project scope, or target creates a distinct proposal only from a newly run preview; where it corrects an earlier proposal, the new record links to it.
- Degraded previews may be persisted only for the supported, evidence-bearing subset; the proposal retains all degradation markers and cannot imply that unavailable analysis ran.

### 4. Approval policy metadata for future compatibility

Workspace/project policy determines how a future action would be approved, with project override and a PM/admin default for sensitive changes. This slice records the effective policy and risk classification but does not approve or execute anything.

The future policy is risk-based: deterministic low-risk changes may permit self-approval, while owner, cycle, critical-priority, and duplicate decisions require another authorized person. Capturing this now avoids creating proposal payloads that cannot support the approved future apply model.

## Explicit non-goals

- No apply, execution dispatcher, issue mutation, approval action, or autonomous triage mutation.
- No change to the legacy status-only apply behavior for existing proposal kinds, except a guard that prevents it from accepting new non-executable triage proposals.
- No Issue schema migration, including no first-class severity, impact, urgency, SLA, source-channel, or triage-state fields.
- No duplicate relation, merge, redirect, automatic close, reparenting, history transfer, or consolidation semantics.
- No issue-dependency MCP exposure in this delivery.
- No capacity-aware routing, team/expertise taxonomy, on-call policy, schedule/forecast/portfolio surface, or workspace rollup.
- No bulk or asynchronous triage, dry-run batch, job status, partial-apply recovery, or durable operation queue.
- No embeddings store, Kanon-hosted model/provider, cross-workspace search, or silent model fallback.
- No external provider synchronization, inbound webhook handling, durable event delivery, retries/DLQ, or integration conflict policy.
- No removal, rename, or consolidation of existing MCP tools.
- No web triage UI in the first delivery.

## Follow-up roadmap, not part of this change

| Follow-up | Why it is later |
|---|---|
| Typed proposal execution/apply | Requires optimistic concurrency, action dispatch, idempotency, reviewer attribution, atomic results, audit, and the approved risk-based self/second-approver policy. Existing apply is status-only. |
| Issue-dependency MCP exposure | Valuable P0 parity work over an existing API model, but independent of a single-issue triage preview. |
| Duplicate consolidation | Needs canonical relation, merge/redirect/close rules, child/dependency/time/history handling, conflicts, and rollback semantics. |
| Capacity, schedule, forecast, and portfolio reads | Requires trustworthy ownership/capacity/read-model definitions rather than inference from work sessions. |
| Bulk asynchronous triage | Requires operation status, strict batch limits, per-item outcomes, retry/resume, and durable partial-failure handling. |
| First-class severity/impact/urgency/SLA | Requires vocabularies, tenant policy, migrations, timers, reporting, and escalation behavior. |
| Integrations and durable operations | Requires mounted provider contracts, sync conflict policy, correlation/idempotency, durable events, retry, and DLQ/rebuild operations. |

## Approaches considered

### A. Extend the current composable MCP workflow only

Expose `q` on `kanon_list_issues`, let the host call repeated `get_issue` operations, ask its model to infer recommendations, and store the result in the existing generic proposal payload.

**Why not chosen:** it is the smallest code change, but it preserves local full-fetch pagination, amplifies round trips and context use, leaves recommendation evidence untyped, and cannot meet exact deduplication, immutability, expiration, or safe legacy-apply separation.

### B. Layered bounded search + hybrid preview + explicit immutable proposal

Build bounded server-side search/projection, keep deterministic policy and validation in Kanon, allow evidence-bearing host-AI suggestions, and separate preview from proposal persistence.

**Chosen:** this is the smallest slice that creates visible value and a trustworthy record while addressing the scale bottleneck. It reuses domain primitives, avoids hidden writes, supports degraded operation, and creates a compatible foundation for later action execution.

### C. One autonomous triage mutation tool

Create a monolithic tool that searches, classifies, assigns, changes priority/cycle, and resolves duplicates in one call.

**Why not chosen:** it has a high blast radius, combines deterministic and ambiguous judgment, obscures permissions and evidence, races concurrent web/provider edits, and is difficult to audit or roll back. It would duplicate existing issue/cycle/action semantics.

### D. Build bulk async triage or the broader enterprise platform first

Start with jobs, issue dependencies, capacity/portfolio data, SLA fields, and integration infrastructure before shipping a user-facing preview.

**Why not chosen:** those capabilities remain important, but they greatly expand domain and operational scope. The selected slice validates triage value and trust with one issue while creating reusable search and proposal foundations.

## Affected areas and compatibility

| Area | Expected impact |
|---|---|
| `packages/api` issue query/schema/service/routes | Add or factor bounded search, stable ordering, field projection, source version/hash, permission-safe project/workspace scope, and response metadata. |
| `packages/api` proposal/policy routes and services | Add versioned triage proposal creation/read/lifecycle rules, exact deduplication, immutable content, supersession, expiration, provenance, and a guard against legacy apply. |
| `packages/api/prisma` | Add the dedicated immutable triage-ledger migration; preserve legacy proposal rows and status behavior. The `Issue` model must not change. |
| `packages/mcp` client, schemas, transforms, tool registration, instructions, and description tests | Expose additive preview and explicit persistence/read capabilities with compact defaults and degradation metadata; preserve all existing tools and update count/budget assertions consistently. |
| `packages/shared` (`@kanon/shared`) | Conditionally share the versioned recommendation/proposal contract only if the implementation uses this existing package as the API/MCP schema boundary. No unrelated shared-domain expansion. |
| `packages/web`, `packages/cli`, `packages/setup` | No new first-slice UI/CLI/setup workflow. Existing proposal and issue behavior must remain compatible; a legacy surface must not be able to mark a triage proposal applied. |
| Documentation/tests | Update tool inventory and description-budget expectations together; verify API/MCP authorization, scale, immutability, deduplication, provenance, degradation, and compatibility. |

Compatibility constraints:

- Existing MCP tools remain registered and retain their established inputs/outputs.
- Existing issue reads/writes and all Issue rows remain compatible; no Issue migration is allowed.
- New retrieval behavior must not silently broaden `kanon_list_issues` scope or expose fields previously protected by API authorization.
- Legacy proposal rows and existing proposal kinds remain readable. Existing `kanon_apply_proposal` may retain current status-only semantics for legacy kinds, but must fail closed for the new triage contract/kind.
- Triage ID resolution is triage-ledger-first: a found-but-invisible triage target returns exactly the same not-found-or-not-visible response as absence, reveals no triage existence, never falls through, and an authorized triage ID appends rejection audit and rejects as non-executable before any legacy lookup; only actual ledger absence enters unchanged legacy lookup.
- Existing generic `targetRef` deduplication cannot be treated as satisfying triage exact identity. Both contracts must coexist without collisions.
- Any new MCP registrations should be deferred/on-demand by default unless an equivalent cold-tool reclassification keeps startup context within the existing tested ceiling.

## Success criteria

| Measure | Acceptance threshold |
|---|---|
| Zero hidden writes | Repeated preview calls produce no changes to Issue, proposal, activity/audit lifecycle, or domain-event state. Only the separately invoked persistence action creates a proposal. |
| Bounded retrieval | One preview evaluates one issue and at most 10 candidate issues. Limit and projection are enforced server-side; no MCP full-project/workspace fetch precedes local slicing. |
| Interactive latency | P95 preview completes in under 3 seconds for one issue and up to 10 candidates under the agreed reference load. Host AI may not extend the deadline: the result degrades to deterministic-only output when AI/context is not available in budget. |
| Explainability completeness | 100% of returned recommendations and duplicate candidates include evidence, confidence, source class, and reason. Deterministic output identifies policy version; AI output additionally identifies provider/model/version. Unsupported items are `unknown`/omitted, never fabricated. |
| Permission-safe scope | Project is the default scope. Workspace expansion requires explicit request and authorization. Authorization tests show no forbidden issue content, keys, counts, ranking influence, or existence clues in results or errors. |
| Proposal immutability | Attempts to mutate payload, evidence, confidence, provenance, generator, or source snapshot are rejected. Correction creates a linked superseding proposal. Only audited lifecycle metadata changes. |
| Exact deduplication | Concurrent/retried persistence with identical workspace/project, target, source version, normalized actions, and generator identity returns one proposal ID and one row. Any approved identity change creates a distinct row. |
| Stale-state safety | Persistence against a changed, deleted, moved, or no-longer-visible source fails with an explainable conflict/authorization result and creates no proposal. |
| Lifecycle safety | New triage proposals expose pending/dismissed/expired only. No API, MCP, or legacy apply path can mark or execute one as applied. |
| Compact output | The default maximum-candidate compact preview is no more than 16 KiB serialized, excludes full descriptions by default, and uses bounded evidence snippets. A larger diagnostic tier is explicit and still server-bounded. |
| Tool-description budget | Existing MCP description reduction and fixed-ceiling tests continue to pass. Startup tool-description bytes do not exceed the current tested ceiling; tool counts, deferred/core classification, instructions, and release documentation are updated together. |
| Degradation | AI unavailable, model timeout, candidate timeout, or optional-context loss returns a typed degradation reason, completeness indicator, and supported deterministic subset within the latency budget. It never silently switches model or invents context. |
| Audit/provenance | Every persisted proposal identifies initiator/client, generator, policy version, model identity when used, source version/snapshot, effective scope, evidence/confidence, degradation, creation time, and trace ID. Dismissal/expiration records actor, time, and reason without altering content. |
| Data-model boundary | The delivery contains no `Issue` model/schema migration and creates no SLA timers, duplicate relations, capacity facts, or issue-dependency records. |
| Backward compatibility | All pre-existing MCP tool contract tests remain green; legacy proposal data remains readable; legacy apply behavior cannot consume the new triage proposal type. |

## Risks and mitigations

| Risk | Mitigation in this proposal |
|---|---|
| Prompt injection in issue descriptions or candidate text | Treat all issue content as quoted untrusted data, not instructions. Do not allow model output to invoke tools or choose authorization scope. Validate model output against the typed contract and Kanon policy; discard unsupported actions. |
| Permission leakage during workspace search | Authorize before query/ranking/projection, intersect token project scope at the API boundary, fail closed for inaccessible requested scope, and avoid forbidden totals or omission counts. Test duplicate project keys and scoped tokens. |
| Stale or concurrently edited issue state | Include source version/hash and immutable snapshot; revalidate on persistence; reject changed/deleted/moved targets. Preserve versioned actions so future apply can add optimistic concurrency without reshaping proposals. |
| Local pagination/full-fetch remains on the hot path | Make server-side limiting/projection an acceptance condition, instrument rows scanned/returned and latency, and prohibit MCP-side full collection fetch for preview. |
| AI latency, nondeterminism, or unavailable context | Enforce the three-second deadline, return deterministic-only degradation, require policy/model identity and per-item evidence, and never infer unavailable capacity or permission data. |
| Model confidence is treated as certainty | Require confidence on each item, retain source/evidence, surface conflicts and unknowns, and define calibration/threshold behavior before any future apply. No confidence value bypasses policy. |
| Exact dedup races across API instances | Back the canonical identity with transactional/unique persistence semantics rather than an in-memory check. Return the existing record on a duplicate race. |
| Immutable proposals retain sensitive text | Use bounded evidence snippets and minimal source projection, apply existing issue visibility to reads, avoid unnecessary descriptions/identity data, and settle retention/export policy before rollout. |
| Current proposal schema cannot represent the approved lifecycle safely | Treat proposal persistence as an explicit schema-evolution decision. Add a versioned triage representation rather than overloading free-form generic payload/status; use additive migration and rollback-safe coexistence. |
| Legacy `kanon_apply_proposal` suggests or performs the wrong behavior | Clearly document current status-only semantics, preserve it only for compatible legacy kinds, and add a fail-closed guard so triage proposals cannot become `applied`. Execution remains a separate follow-up. |
| Tool count and context drift | Keep new capabilities deferred/on-demand, preserve description byte ceilings, and update registration-count tests, instructions, baseline fixtures, and documentation in one change. |
| Future apply cannot consume the record | Normalize action intent, source version, risk/approval policy, idempotent identity, evidence, and provenance now; do not encode triage-only mutation semantics. |
| Scope expands into the enterprise roadmap | Enforce the explicit non-goals and follow-up table. In particular, do not add Issue fields, duplicate relations, dependencies, capacity, batch jobs, providers, or durable queues to complete this slice. |

## Migration and rollback

### Migration expectations

- **No Issue schema migration is permitted.** Severity, impact, urgency, SLA, and duplicate conclusions remain proposal metadata only.
- Triage persistence uses a dedicated immutable triage ledger, separate from legacy `McpProposal`; each row carries the typed contract, exact identity, source snapshot, provenance, audit, and non-executable lifecycle.
- Migration is additive and starts with feature flags off: preserve legacy rows/status behavior and retain all triage-ledger rows and audit records.
- Recovery is fix-forward: turn flags off, retain rows/audit, repair forward, then export/backfill and verify before any destructive down-migration; destructive change needs separate approval.
- Search/preview API and MCP surfaces are additive. Existing tools and routes remain available.

### Rollback expectations

- Operator rollback is flag-off first; it must not delete triage rows, erase audit, or weaken the legacy-apply guard while rows remain.
- Rollback stops new reads/writes while retaining the ledger for audit and recovery; no Issue mutation or compensating write is needed.
- Existing generic proposals, issue workflows, and all 44 current MCP tools continue operating.

## Open questions carried to specification/design

These do not reopen the approved product direction:

1. **Expiration and retention policy:** What default or configurable interval moves a proposal to expired, how long are expired/dismissed records retained, and what export requirements apply to auditors? Content remains immutable under any answer.
2. **Confidence representation and calibration:** The contract requires confidence and complete provenance, but the specification must select the vocabulary/scale, thresholds, and monitoring method before future approval/apply can rely on it.

## Release and operational gates

- **`green`** means every required build, generation, test, security, concurrency, and performance command for this slice exits zero and all required assertions pass: 100% of required checks, not a pass-rate substitute; flags stay off until an operator approves a canary.
- For each stage—search, preview, host-AI/degradation, persistence/deduplication, source-conflict, and lifecycle—record outcome, latency, and correlation identity; expected source conflicts and dedup hits are outcomes, not errors.
- Use a rolling 5-minute window per stage with a denominator of at least 100 completed requests; unexpected stage errors over 1% page the owner and disable that stage flag, while typed degradation over 10% pages the owner and halts canary exposure for that stage.
- Unexpected errors over 5% in any such window with the minimum sample page incident command and disable all triage flags; any security or invariant violation immediately disables all flags, preserves rows/audit, and fixes forward.
- Threshold actions only page or disable exposure; no alert or recovery path mutates issues, proposal content, or audit history, and no destructive recovery runs.
- Performance remains a separate gate: the reference-load preview MUST stay under 3 seconds at P95; failure is a flag-off and fix-forward decision, not a substitute for green.
- Every required assertion, including stage, security, concurrency, and performance gates, must pass before re-enable.

## Rollout signal

This first delivery is successful when a large-team user can obtain a fast, permission-safe, explainable preview and explicitly preserve it as a trustworthy non-executable record—while all issue state, existing MCP tools, and legacy proposal data remain intact. Only then should the program advance to execution/apply or the ranked enterprise follow-ups.

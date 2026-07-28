# Safe large-team triage architecture

## Executive design

Implement triage as three additive layers:

1. a target-anchored, server-bounded issue search service in the API;
2. a read-only deterministic preview that can be enriched through an explicit host-suggestion validation round trip; and
3. a dedicated immutable triage-proposal ledger, separate from legacy `McpProposal`.

The MCP server does **not** assume it can call the host model. The same deferred read-only tool supports `prepare` and `validate` phases. A host without model or Sampling support stops after `prepare` and receives a complete deterministic preview. A host that performs its own reasoning submits typed suggestions in `validate`; Kanon revalidates every reference, canonical value, policy rule, source version, and permission. Persistence is a different tool and API transaction. The board-health outcome is explainable resurfacing/focus plus duplicate-candidate detection; no path autonomously merges, closes, applies, or otherwise changes an Issue.

The implementation adds five deferred MCP tools, producing an exact inventory of **49 tools: 26 core and 23 deferred**. All existing 44 contracts remain unchanged. Proposal review is project-only, compact, visibility-first, and server-paginated; dismissal is an explicit terminal lifecycle write. The fixed 5,350-byte topline ceiling and 1,950-byte instruction ceiling are not re-anchored.

## Review path and scope guard

Review in this order:

1. host protocol and trust boundary;
2. bounded query, authorization, source identity, and cursor;
3. dedicated ledger, transactions, lifecycle, and legacy-apply isolation;
4. MCP contracts, budgets, tests, and rollout.

Intentionally out of scope: Issue fields or migration, duplicate relations/merge, proposal approval/apply, capacity inference, dependencies, bulk jobs, web UI, hosted models, external providers, and durable queues.

## Architecture and component boundaries

```text
MCP host
  ├─ CallTool kanon_preview_issue_triage (prepare)
  │    └─ KanonClient POST /api/issues/:key/triage/preview
  │         ├─ triage-specific target authorization
  │         ├─ bounded search (repeatable-read, max 10)
  │         ├─ deterministic policy v1
  │         └─ compact preview + contextToken + previewSeal (zero domain writes)
  ├─ host model/reasoning outside Kanon (optional)
  ├─ CallTool kanon_preview_issue_triage (validate)
  │    └─ same API route
  │         ├─ token/source/permission revalidation
  │         ├─ strict host-suggestion validation
  │         └─ final preview + previewSeal (zero domain writes)
  ├─ CallTool kanon_persist_triage_proposal (explicit write)
  │    └─ POST /api/issues/:key/triage-proposals
  │         └─ serializable transaction + immutable ledger + exact dedup
  ├─ CallTool kanon_get_triage_proposal (read)
  │    └─ GET /api/triage-proposals/:id
  │         └─ current target/candidate authorization + signal-free projection
  ├─ CallTool kanon_list_triage_proposals (read)
  │    └─ GET /api/projects/:key/triage-proposals
  │         └─ visibility-first compact snapshot page; no workspace scope
  └─ CallTool kanon_dismiss_triage_proposal (lifecycle write)
       └─ POST /api/triage-proposals/:id/dismiss
            └─ member+ row lock + terminal audit; zero Issue mutation
```

| Boundary | Responsibility | Must not do |
|---|---|---|
| MCP tool adapter | Tool discovery, compact inputs/results, correlation ID, REST calls, semantic error mapping | Prisma access, role decisions, local candidate/proposal paging, model assumption |
| API triage routes | Wire schemas, target-safe authorization, deadline, correlation | Embed host prose without validation |
| Bounded search service | Authorized scope, filtering, ranking, projection, limit, cursor, source identity | Return forbidden totals or full descriptions |
| Triage policy/validator | Stable deterministic rules, confidence bands, evidence and host validation | Invoke tools/network, infer capacity, override authorization |
| Proposal service | Current target/candidate authorization before create, dedup return, get/list and every retained-candidate projection; canonical identity, immutable storage, redaction, lifecycle/retention | Update Issue, expose workspace queues, execute actions, emit Issue events |
| PostgreSQL | Snapshot reads, row locks, unique identity, append-only audit, immutability constraints | Depend on process-local EventBus for correctness |

Preview emits only normal Pino access/stage logs and Prometheus metrics. It creates no proposal, ActivityLog, AdminAuditLog, lifecycle event, notification, relation, or domain event. Proposal lifecycle truth is durable database state; the in-process EventBus is not used.

## Lasting decisions and alternatives

| Decision | Selected design | Alternative considered and why not selected |
|---|---|---|
| Host-AI protocol | Explicit `prepare` → host reasoning → `validate`, with deterministic `prepare` as a final fallback | MCP `sampling/createMessage`: not universally advertised/approved and standard results do not reliably provide provider plus model version. Host-only overlay without validation: cannot safely persist or resolve conflicts. |
| MCP surface | Five deferred tools; preview has two read-only phases, while persist, get, project-list, and dismiss remain explicit | Three get-only tools: no bounded review queue or explicit MCP lifecycle action. Six tools with separate preview validator: needless discovery cost. One god-tool: mixes reads/writes and hides consent. |
| Search API | New target-anchored bounded service/route; leave `listIssues` semantics untouched | Add cursor/projection to existing list route immediately: risks changing an established array response. MCP full-fetch plus local rank: violates scale and side-channel requirements. |
| Search indexing | Use existing Issue indexes and one SQL ranked query over the authorized project set; no Issue migration | Add `pg_trgm`/Issue title indexes: likely faster at larger scale, but violates this change's no-Issue-migration boundary. Embeddings are out of scope. |
| Source version | Derive opaque `sourceVersion` from `Issue.updatedAt` plus `Project.updatedAt`; hash canonical source fields | Add a dedicated Issue version column: stronger counter semantics but prohibited. Use Issue.updatedAt alone: misses represented project-key/location context. |
| Proposal storage | Dedicated `TriageProposal` metadata/content/lifecycle tables | Extend `McpProposal`: nullable-column overload, legacy `applied` enum, generic list/UI Apply buttons, and partial-index coupling make fail-closed isolation fragile. |
| Proposal review queue | Project-only visibility-first keyset pages, compact rows, snapshot-bound opaque cursor | Reuse legacy workspace proposal list: wrong type/auth/projection and exposes workspace cardinality. Offset pagination or full rows: unstable under writes and unnecessarily sensitive. |
| Exact identity | Canonical JSON v1 + SHA-256 unique digest across all lifecycle states | Client idempotency key: does not prove semantic equality. Pending-only targetRef: ignores source, payload, generator, and terminal records. |
| Authorization | Reuse API role hierarchy/token claims and triage-specific permission-safe resolvers | Duplicate role logic in MCP: drift and bypass risk. Workspace membership alone: leaks projects a viewer/member cannot access. |
| Observability | Existing Fastify/Pino/prom-client registry plus durable proposal lifecycle rows | Domain EventBus lifecycle notifications: process-local and non-durable. IDs/search strings as labels: cardinality/privacy leak. |
| Shared contracts | API-local authoritative Zod v1 schemas; MCP-local wire schemas checked by contract fixtures | Put triage in `@kanon/shared`: MCP currently has no runtime dependency on it and is intentionally self-contained; copying another large schema would create drift. |
| Retention/policy | Versioned workspace policy, optional project approval override, values captured per proposal | A global constant: not workspace configurable. Re-evaluate all old rows on policy update: could silently shorten history. |
| Rollout | Additive schema, guard-first API, flags off, preview canary, persistence last | Ship tools and writes before the apply guard/migration: rollback could expose triage IDs to legacy apply. |

### ADR recommendations

Do not create ADR files in this phase. Before implementation, record two ADRs because they constrain multiple packages and future apply work:

- **Host-mediated triage protocol:** explicit two-phase validation rather than a Sampling dependency.
- **Dedicated immutable proposal ledger:** dedicated typed storage and fail-closed coexistence with `McpProposal`.

## Host-AI protocol and trust boundary

### Why Sampling is not the v1 dependency

A Sampling implementation would send the protocol request `sampling/createMessage` from server to client after preparing context, but only after the MCP client advertised the `sampling` capability. It would also need host approval, a sub-deadline, strict JSON parsing, and complete provider/model/version provenance. The current server registers tools only and contains no Sampling capability path. More importantly, provider and model-version identity are not portable enough across hosts to satisfy the proposal contract.

Therefore v1 **never sends `sampling/createMessage`**. Absence of Sampling is normal, not an error. A later capability-gated optimization may use it only if the host supplies all required provenance; denial, unsupported capability, invalid output, or timeout must fall back to the protocol below without changing providers.

### Exact MCP flow

First call:

```json
CallTool kanon_preview_issue_triage
{
  "phase": "prepare",
  "issueKey": "KAN-42",
  "scope": { "kind": "project" },
  "format": "compact",
  "aiIntent": "host_assisted"
}
```

The tool calls `POST /api/issues/KAN-42/triage/preview` with the same semantic body, a 2,500 ms API budget, and `X-Kanon-Correlation-ID`. The result is already a valid deterministic preview. When `aiIntent=host_assisted`, it additionally contains:

- an opaque, 15-minute `contextToken`;
- bounded evidence objects tagged `untrusted_issue_text` or `deterministic_fact`;
- allowed recommendation concepts and canonical references; and
- fixed host instructions saying evidence is data, never instructions.

Second call, only if the host attempted AI reasoning:

```json
CallTool kanon_preview_issue_triage
{
  "phase": "validate",
  "issueKey": "KAN-42",
  "contextToken": "ctx.v1.…",
  "hostOutcome": {
    "status": "completed",
    "provider": "reported-provider",
    "model": "reported-model",
    "modelVersion": "reported-version"
  },
  "suggestions": ["typed objects referencing evidenceRefIds"],
  "format": "compact"
}
```

`hostOutcome.status` is `completed | unavailable | timed_out | invalid`. A failed outcome has no suggestions and produces the corresponding deterministic degraded success. Model identity is caller-reported provenance, stored as such, never treated as an authorization or policy fact.

The API decrypts the token, checks its expiry, target, effective source/scope bindings, authorization-policy and search/ranking-policy versions, source versions/hashes, authorized context digest, and correlation family; it reauthorizes and re-reads every referenced source before validation. Unknown object keys, URLs/tool calls, scope fields, unsupported concepts, arbitrary evidence text, invalid canonical IDs, or missing provenance are rejected. Evidence is selected by `evidenceRefId`; host-provided excerpts are never accepted. Issue text and host reasons are never executed, interpolated into a tool request, or used to choose scope.

Both phases return a final preview and `previewSeal`. The seal is an authenticated token containing the canonical preview digest, exact target/retained-candidate source and scope, contract, authorization-policy, and search/ranking-policy bindings—not the preview body. Persistence separately validates seal authenticity and freshness plus those bindings before computing identity or recovering a deduplicated row; the seal's authentication/freshness token bytes and request-time data are not part of proposal identity. Persistence receives the returned preview plus seal, so any changed evidence, reason, confidence, scope, policy, or source is rejected without storing a hidden preview row. A stale/tampered seal cannot create. An expired but authentic seal may only recover an already-committed exact identity after current target/candidate authorization and source checks; if no exact row exists, rerun preview. This preserves unknown-commit retry without reinterpreting stale input.

If the host has no model, it calls only `prepare` with `aiIntent=none` (or uses the deterministic result from `host_assisted`). If it attempted AI and failed, it reports that failure through `validate`; Kanon does not claim an unreported model attempt occurred.

## MCP tool contracts and budgets

| Tool | Input summary | Result | Annotation |
|---|---|---|---|
| `kanon_preview_issue_triage` | Discriminated `prepare` or `validate`; one issue; project/default or explicit workspace; compact/default or full | Versioned preview, source/scope/completeness, evidence, degradation, correlation, seal | `readOnlyHint:true`, `destructiveHint:false`, `idempotentHint:true`, `openWorldHint:false` |
| `kanon_persist_triage_proposal` | Exact returned preview + seal, optional retained item IDs and `supersedesId` | Created/deduplicated typed proposal; never applied | `readOnlyHint:false`, `destructiveHint:false`, `idempotentHint:true`, `openWorldHint:false` |
| `kanon_get_triage_proposal` | Proposal UUID, compact/default or full | Currently authorized immutable content with candidate-safe redaction and effective lifecycle/history, or disposed tombstone | `readOnlyHint:true`, `destructiveHint:false`, `idempotentHint:true`, `openWorldHint:false` |
| `kanon_list_triage_proposals` | Required `projectKey`; state/target/generator/degraded filters; limit 1..50/default 20; cursor; no scope/format input | Compact-only authorized page, returned count, snapshot metadata, optional next cursor | `readOnlyHint:true`, `destructiveHint:false`, `idempotentHint:true`, `openWorldHint:false` |
| `kanon_dismiss_triage_proposal` | One proposal UUID and Unicode-trimmed reason of 1..1000 characters | Original/new terminal outcome and immutable lifecycle audit summary | `readOnlyHint:false`, `destructiveHint:true`, `idempotentHint:true`, `openWorldHint:false` |

The preview handler manually parses the full refined Zod union, following the existing `kanon_batch_transition` precedent where `.shape` alone cannot enforce cross-field rules. All five registrations remain behind `DEFERRED_TOOLS`/ToolSearch.

Exact post-change inventory:

- existing: 44 = 26 core + 18 deferred;
- added: 5 deferred;
- final: **49 = 26 core + 23 deferred**.

`DESCRIPTION_BASELINE_BYTES` remains 5,650, so the fixed topline ceiling remains 5,350 bytes; verified current 44-tool toplines total 5,300 bytes. Five semantically complete descriptions are forecast at 350–420 bytes total. Trim at least 445 bytes across existing verbose capture, batch, cycle, and timesheet descriptions without crossing the existing 50-byte per-tool floor or removing firing-pin wording; target <=5,275 bytes leaves >=75 bytes headroom. Adding two deferred names/instructions is offset by at least 120 bytes of stale/redundant persona and core-list prose, targeting <=1,900 bytes under the unchanged 1,950-byte instruction ceiling.

## API contracts

### Bounded search

`POST /api/issues/:key/bounded-search` is a read-only target-anchored route. The target establishes default project/workspace identity and the existing issue visibility boundary.

Input at design level:

```text
q: normalized non-empty text, max 256 bytes
filters: allowlisted state/type/priority/label/group/assignee/cycle
scope: {kind:"project"} | {kind:"workspace", workspaceId:UUID}
projection: "compact" (default) | "full" (still bounded)
limit: integer 1..10, default 10
cursor?: opaque bounded-search cursor
excludeTarget: true (fixed for this route)
deadlineMs: 100..900, server-clamped downward only
```

Success includes contract/ordering versions, projected rows with one-based ranks and source identity, exactly one of `complete | bounded | timed_out | degraded`, limit, returned authorized count, safe effective scope, optional cursor, degradation list, and correlation ID. V1's single ranked SQL is all-or-nothing: statement timeout yields no trustworthy partial rows and therefore returns temporary unavailability directly; the service schema still represents all four completeness states. Preview catches candidate timeout and returns deterministic output with candidate completeness `timed_out` and no claim of exhaustive ranking. V1 omits cursors for `timed_out`/`degraded` because consistent continuation is not guaranteed. It never returns a false empty `complete` result.

Projection allowlists:

- `compact`: issue ID/key, project ID/key, title, type, priority, state, at most eight normalized labels with a truncation marker, group key, assignee ID, cycle ID, sourceVersion/hash;
- `full`: compact plus bounded target/candidate validation facts and excerpts; no email, unrelated member identity, comments, documents, active workers, or full description.

Full descriptions may be read internally for the at-most-11 selected rows to compute hashes/excerpts, but are never present in the search response.

### Preview

`POST /api/issues/:key/triage/preview` accepts the two phases described above. It calls the bounded search service in-process; it does not issue an internal HTTP request or call `listIssues`. Compact and full are capped at 16 KiB and 48 KiB respectively.

Every preview envelope includes contract version; `observedAt` from the read transaction and response `generatedAt`; target workspace/project/stable issue reference, bounded snapshot, source version/hash; effective authorized scope; search completeness; policy ID/version; recommendations, candidates, conflicts, unknowns, degradation; and correlation ID. Every supported recommendation includes a stable item ID, normalized typed value/operation, `deterministic_policy | host_ai`, reason, item-specific visible evidence refs, confidence band/basis, rule version when deterministic, and reported provider/model/modelVersion when AI contributed. Every candidate includes unique one-based rank, stable issue ref, candidate source version/hash, source class, reason, item-specific evidence, and confidence band/basis.

Mandatory preview fields are not dropped. Limits are: 10 recommendation concepts, 10 candidates, two evidence refs per compact item (three full), 160-byte compact excerpts, 240-byte reasons, and bounded unknown/conflict/degradation arrays. If the serialized compact body would exceed 16 KiB, optional snapshot/validation detail is removed first; then the lowest-priority whole optional item is omitted with `output_truncated`. Evidence is never removed from an item that remains `supported`.

### Proposal endpoints

- `POST /api/issues/:key/triage-proposals` — member+ explicit persistence.
- `GET /api/triage-proposals/:id` — viewer+ read while the target remains visible; returns immutable content, effective lifecycle, ordered lifecycle history, and authorized forward/reverse supersession references.
- `GET /api/projects/:key/triage-proposals` — viewer+ project-only compact list; strict filters, server keyset pagination, no workspace/multi-project form.
- `POST /api/triage-proposals/:id/dismiss` with strict body `{reason}` — member+, Unicode-trimmed 1..1000 characters, terminal-idempotent.
- `PATCH /api/triage-proposals/:id` — after safe authorization, always returns `409 IMMUTABLE_TRIAGE_PROPOSAL`; content changes are not a supported operation.
- `GET|PUT /api/workspaces/:id/triage-policy` and `GET|PUT /api/projects/:key/triage-policy` — admin+ configuration; no MCP/UI surface. PUT increments the relevant policy version and writes an `AdminAuditLog` with actor, prior/new policy digest, reason, time, and correlation in the same transaction.

Semantic categories are `validation`, `not_found_or_not_visible`, `authorization`, `source_conflict`, `immutable_content_conflict`, `terminal_lifecycle`, `temporary_unavailability`, `unsupported_non_executable`, and degraded success. Every API body carries API contract version, correlation ID, safe retry guidance, and safe provenance (policy version when known and source version only when the caller is authorized). The MCP adapter preserves those fields and adds MCP server/contract version; the API does not invent an MCP version for direct callers. Missing and non-visible targets/proposals/projects use 404 `NOT_FOUND_OR_NOT_VISIBLE`; a visible viewer attempting a write gets 403.

## Proposal review queue design

`GET /api/projects/:key/triage-proposals` uses a strict query schema; unknown keys fail before execution:

```text
state?: "current" (default) | "superseded" | "dismissed" | "expired" | "disposed" | "all"
targetIssueKey?: exact non-empty issue key, max 120 characters
generatorSource?: "deterministic_policy" | "host_ai" | "mixed"
degraded?: exact wire boolean "true" | "false" (never truthiness-coerced)
limit?: integer 1..50, default 20
cursor?: opaque token, max 2048 bytes
```

There is no `workspaceId`, project array, projection, free-text, offset, or sort input. The MCP tool requires one explicit `projectKey` and maps these fields without local filtering. Its result contains contract/order versions, project scope only after authorization, `snapshotAt`, returned authorized count, compact rows, optional `nextCursor`, and correlation ID. It never returns a total, scanned, excluded, forbidden, or workspace count.

Non-disposed compact rows contain only proposal ID, fixed kind/contract version, target issue key, normalized action-kind names, effective state/current flag, created/expiry times, bounded generator/policy/model summary, present confidence bands, degradation boolean/categories, and forward supersedes/reverse successor IDs when authorized. Evidence, reasons, source snapshot, normalized values, initiator details, lifecycle history, and full content require get. A disposed row is a different projection containing only ID, kind/version, target ref, `disposed`, disposition time/action and retention policy ID/version; generator/action/confidence/content fields are absent. Disposed rows appear only for explicit `disposed|all` and only when the captured workspace policy's `disposedListVisibility` is true (default false).

### Visibility-first query and effective state

A triage-specific project resolver establishes viewer+ access and token scope with the same 404 for missing/forbidden projects before list SQL. In one read-only `REPEATABLE READ` transaction, a `visible_targets` CTE joins current `Issue` rows in that one non-archived project before proposal state, filter, snapshot digest, order, or `LIMIT`. This matches current project-level Issue visibility and preserves the boundary for future finer ACLs. Deleted/moved targets and unauthorized projects contribute nothing. Hidden rows never affect positions, cursor issuance, or caller-visible metadata.

At fixed database `snapshotAt`, effective state is evaluated in required precedence:

```text
disposed   := disposed_at IS NOT NULL
dismissed  := not disposed and a dismissed terminal event occurred <= snapshotAt
expired    := neither above and (expired event <= snapshotAt or expires_at <= snapshotAt)
superseded := neither above and a valid successor was created <= snapshotAt
current    := none above (pending, unexpired, undisposed, no as-of successor)
```

The query derives terminal state from append-only lifecycle events rather than mutable current status, so a dismissal/expiry after page 1 does not rewrite the earlier snapshot. It applies the normalized state/target/generator/degraded filters after `visible_targets`, orders `created_at DESC, id DESC`, and fetches `limit+1`. Only `limit` compact rows leave the API; `nextCursor` exists only when the extra authorized row exists.

### List snapshot and cursor

Cursor contract `triage-proposal-list.v1` encrypts/authenticates project ID, normalized filters, literal compact projection, order version, caller authorization digest, `snapshotAt`, a source marker, and the last `{createdAt,id}` keyset tuple. The authorization digest covers user/member identity, effective project role and membership update marker, and token project-scope digest. Every page re-runs project, target, and retained-candidate authorization under the cursor-bound authorization-policy version before projection; loss of project/target access returns permission-safe 404, candidate loss uses signal-free redaction, and a still-authorized but changed bound context returns 409 source conflict.

New proposals are excluded by `created_at <= snapshotAt`; successors and lifecycle events after `snapshotAt` are ignored for as-of state. After visibility/filtering, a private ordered source marker uses `md5(coalesce(string_agg(proposal_id || created_at_us || effective_state || target_issue_id || target_project_id || content_present || disposition_list_visible, ',' ORDER BY created_at DESC, proposal_id DESC), 'empty'))` and is compared with the cursor value. A target move/delete, retention disposal, policy-discovery change, or other change that makes the as-of compact set unreconstructable returns `409 LIST_SNAPSHOT_CONFLICT`; the server never restarts or skips. The digest and authorization details are never returned outside the encrypted token. List cursors use the same versioned HKDF key family as search with a distinct context and random AES-GCM nonce; unlike search retry cursors, first-page list snapshots need not be byte-identical.

## Bounded search design

### Authorization before match and rank

A new triage target resolver uses the existing `ROLE_HIERARCHY`, token `allowedProjectIds`, `Member`, and `ProjectMember` semantics but performs a permission-safe joined lookup. It maps both absence and failed visibility to the same 404. MCP performs no role logic.

Project scope contains only the target project. Workspace scope is valid only when the supplied workspace UUID equals the target workspace. The authorized-project CTE is:

- all non-archived projects in that workspace for workspace owner/admin; or
- non-archived projects having a `ProjectMember` row for the caller.

In both branches, a non-empty token `allowedProjectIds` claim is intersected first; absent/empty retains the existing unscoped-token behavior. Viewer is sufficient for reads. The CTE is joined before query matching, population fingerprinting, ranking, counting, and projection. Responses say only `project` or `workspace` plus the target/selected workspace identity; they never enumerate excluded projects or expose scanned/forbidden counts.

### Query, order, cursor, and indexes

Normalize query text with Unicode NFKC, trim/collapse whitespace, lowercase for comparison, cap at 12 Unicode alphanumeric tokens and 256 UTF-8 bytes, and reject a value with no remaining token. Eligibility requires exact/prefix key match or at least one query token in normalized key/title. Preview derives this query only from the target's normalized title (first 12 tokens, 256-byte boundary), falling back to target key when the title has no token; caller/model text cannot override it. Preview supplies no default state/type/assignee filter, so closed issues can still be duplicate evidence. Use one parameterized PostgreSQL query with an authorized-project CTE, explicit supported filters for direct callers, target exclusion, and `LIMIT limit+1`.

Ordering/normalization contract `issue-search.v1` is:

1. exact key;
2. key prefix;
3. exact normalized title;
4. all query tokens present in title;
5. title/key substring;
6. token-overlap count descending;
7. normalized title ascending;
8. issue key ascending;
9. issue UUID ascending.

The lexical score is returned only as reason classes, not a probability. Existing `issues(project_id,state)`, key uniqueness, project membership uniqueness, and project/workspace indexes narrow the query. No column, extension, or index is added to `issues` in this change. If the reference profile fails, rollout remains disabled; a separately approved Issue-index migration is required rather than weakening limits or completeness.

Search runs in a read-only `REPEATABLE READ` transaction with `SET LOCAL statement_timeout`. A private population fingerprint hashes an ordered stream of every authorized matching `{issueId, issueUpdatedAt, projectId, projectUpdatedAt}` tuple plus query/scope/projection/order versions and the authorized-project-set digest. Count/max timestamps alone were rejected because offsetting insert/delete or non-maximum-row changes could evade them. The fingerprint uses built-in `md5(coalesce(string_agg(issue_id || ':' || issue_updated_at_us || ':' || project_id || ':' || project_updated_at_us, ',' ORDER BY issue_id), 'empty'))` (no extension and no rows exposed to MCP). It is a change detector, not an authorization primitive; the cursor's separate authenticated encryption prevents substitution. The reference profile must prove its cost. It is never returned directly.

A cursor contains the seek tuple and fingerprint in an encrypted/authenticated envelope. It is bound to normalized query, filters, projection, ordering/ranking versions, target, authorized scope digest, authorization-policy version, and source snapshot. Cursor plaintext contains no issuance timestamp or request-random value. To make retries return the same opaque cursor, v1 derives the AES-GCM nonce from a separate HMAC key over canonical cursor plaintext; the same plaintext produces the same token, while different plaintext has a collision-negligible distinct nonce. Keys are HKDF-derived from the existing server secret with versioned context strings. Any binding mismatch is validation failure; a changed fingerprint is `409 SEARCH_SOURCE_CONFLICT`, never a restart. `bounded` has a cursor; `complete` does not.

### Source identity

No Issue version column is added.

```text
sourceVersion = "isv1." + base64url(Issue.updatedAt + "." + Project.updatedAt in canonical UTC)
sourceHash    = SHA-256(canonical JSON of persisted triage source fields)
```

The source document contains stable issue/project IDs, issue key, project key, title, description digest, type, priority, state, sorted/deduplicated labels, group key, assignee ID, cycle ID, parent ID, Issue.updatedAt, and Project.updatedAt. Object keys are sorted and null is distinct from absence. The same function is used by search, preview, validation, and persistence. A harmless Issue/Project `updatedAt` change may conservatively conflict; a represented persisted change cannot silently pass.

## Preview policy, evidence, and confidence

`triage-policy.v1` is a pure, versioned evaluator. Stable rule IDs and item IDs determine ordering. It handles schema/canonical checks, direct configured mappings, missing ownership/cycle context, metadata-only restrictions, and lexical duplicate candidates. It does not infer expertise, capacity, SLA timers, or duplicate disposition.

Recommendations are a strict discriminated union for canonical concepts (`type`, `priority`, `labels`, `group`, `assignee`, `cycle`) and metadata concepts (`severity`, `impact`, `urgency`, `sla`). Canonical concepts use current domain enums/IDs and explicit `set | clear` operations; absent is not clear. Metadata values remain proposal metadata. Duplicate candidates are an ordered evidence-only conclusion and never an action.

Risk classification is also deterministic and record-only: `sensitive` covers assignee/owner, cycle, critical-priority, and duplicate conclusions; `low` covers policy-proven deterministic low-risk normalization; `advisory` covers metadata-only recommendations. Default approval metadata allows future self-approval only for deterministic `low` items and requires a second PM/admin for `sensitive`; no approval action exists here.

Confidence remains `low | medium | high`, with fixed explanatory semantics. Host-requested confidence is advisory and is capped by evidence:

- `high`: direct deterministic evidence, or at least two independent corroborating visible classes with no material conflict;
- `medium`: specific visible evidence supports the result but ambiguity remains;
- `low`: weak/incomplete evidence or a policy-valid suggestion that cannot be strengthened.

Numeric scores are never returned. Supported disagreements become `conflict` with both evidence sets and no normalized action. Missing context becomes `unknown` naming the affected context class.

## Canonical proposal identity

Canonicalization version is `triage-c14n.v1`:

- UTF-8 strings are NFKC-normalized where the contract defines human text normalization; stable IDs/enums retain their canonical API form;
- object keys sort by Unicode code point;
- unordered sets (labels, evidence-independent candidate sets where declared) are deduplicated then sorted;
- ranked candidate arrays retain rank order;
- null, absence, `set`, and `clear` remain distinct;
- numbers use the JSON contract's finite integer/decimal representation; timestamps are excluded from normalized payload;
- reason/evidence wording, confidence, initiator, client, and request time are excluded from identity.

Identity document:

```json
{
  "contractVersion": "triage-proposal.v1",
  "authorizationPolicyVersion": "authz-policy.vN",
  "scope": {"workspaceId":"…","projectId":"…","kind":"project|workspace"},
  "target": {"issueId":"…","sourceVersion":"…","sourceHash":"…"},
  "payload": "normalized supported actions, metadata, and candidate conclusions",
  "generator": {
    "kind":"kanon_policy|host_ai_hybrid",
    "id":"triage-preview",
    "version":"1",
    "policy":{"id":"triage-policy","version":"1"},
    "model":"provider/model/version when host AI contributed"
  }
}
```

`identityDigest = SHA-256(canonical JSON bytes)`. A unique database constraint spans every lifecycle state. The authenticated `previewSeal` is validated separately for authenticity, freshness, and target/candidate/source/scope/policy binding before persistence or dedup recovery; its authentication/freshness token bytes and request-time data are never identity material. Different reason/evidence wording, confidence, initiator, client, or request time cannot manufacture a new identity; changed normalized payload, stable source version/hash, scope, target, contract, authorization-policy version, policy/generator, or model identity does. `retainedItemIds` may only remove items from the sealed preview. At least one retained supported evidence-bearing recommendation or candidate is required; unknown/conflict items may remain immutable context but never enter normalized actions.

## Proposal data model and lifecycle

### Dedicated ledger sketch

The additive Prisma/SQL migration creates no Issue field, relation, enum, trigger, or index.

**`triage_proposals`**

- immutable identity/routing: `id UUID PK`, `kind` fixed by a check to `issue_triage_v1`, `contract_version`, `authorization_policy_version`, `source_seal`, `identity_digest CHAR(64) UNIQUE`, `workspace_id`, `project_id`, `target_issue_id` (scalar UUID, deliberately no Issue FK), `target_issue_key`, `source_version`, `source_hash`, `initiator_member_id`, `client_identity`, `created_correlation_id`, `created_at`, `expires_at`;
- immutable compact-list summary: `action_kinds TEXT[]`, `generator_source` enum `deterministic_policy | host_ai | mixed`, `generator_summary JSONB` with bounded IDs/versions only, `confidence_bands TEXT[]`, `degraded BOOLEAN`, and bounded `degradation_categories TEXT[]`; these are derived from sealed content in the create transaction and protected by the immutable metadata trigger;
- immutable policy: approval policy ID/version/risk class; retention policy ID/version/ISO-8601 duration/eligibility time; `supersedes_id UUID NULL UNIQUE` self-FK;
- mutable lifecycle only: dedicated status enum `pending | dismissed | expired`, terminal actor kind/ID, terminal time/reason, `disposed_at`, disposition action, and `disposition_list_visible` captured from policy when disposal occurs.

Workspace/project foreign keys and `supersedes_id` use `ON DELETE RESTRICT` so audit history cannot disappear through a parent deletion; current projects are archived rather than hard-deleted. Initiator/lifecycle actor UUIDs are durable scalar provenance rather than cascading member foreign keys. Content and lifecycle rows reference the proposal, but a proposal-delete trigger rejects deletion because retention creates a tombstone instead. No application delete endpoint is added.

**`triage_proposal_contents`** (one-to-one, PK/FK `proposal_id`)

- `source_snapshot JSONB`, `normalized_payload JSONB`, and versioned `content JSONB` containing recommendations, candidates, evidence, confidence, policy/model/generator provenance, effective scope, degradation, and bounded snapshots. These stored candidate bytes are immutable; get/list construct a current-authorization projection that removes inaccessible candidate key/text/evidence without existence, omission, or count markers and never rewrites content, identity, lifecycle, or links.

**`triage_proposal_lifecycle_events`**

- append-only `created`, `dismissed`, `expired`, `superseded`, `retention_disposed`, `retention_policy_reevaluated`, and `apply_rejected` events with actor kind/ID/client, from/to status where applicable, time, non-empty reason, correlation ID, and bounded safe details.

**Policy tables**

- `workspace_triage_policies`: one row per workspace, version, validated ISO-8601 retention duration (default `P1Y`, minimum `P7D`), `disposedListVisibility` (default false), approval-policy JSON, updated time;
- `project_triage_policy_overrides`: optional one row per project, version and approval-policy JSON. Retention/disposed-list policy always comes from the workspace. The proposal stores computed eligibility and disposition captures discoverability, so later parsing or policy changes cannot silently alter an existing row.

Indexes:

- unique identity digest and unique non-null `supersedes_id` (also the reverse-successor lookup);
- list keyset `(project_id, created_at DESC, id DESC)` and exact-target `(project_id, target_issue_id, created_at DESC, id DESC)`;
- partial pending expiry `(project_id, expires_at, created_at DESC, id DESC) WHERE status='pending' AND disposed_at IS NULL`;
- partial disposed list `(project_id, created_at DESC, id DESC) WHERE disposed_at IS NOT NULL AND disposition_list_visible=true` and retention `(retention_eligible_at)` for non-disposed rows;
- lifecycle `(proposal_id, occurred_at, id)` plus a partial unique terminal-transition event;
- policy primary/unique scope indexes.

Generator/degraded filters remain residual predicates after the project keyset index in v1 rather than multiplying indexes; the `triage-proposal-list-v1` profile must show bounded page/digest cost. Add a proposal-specific generator/degraded index only in this additive migration if that profile fails before enablement—never an Issue index.

SQL checks enforce the fixed non-executable kind, `expires_at = created_at + interval '7 days'`, retention eligibility at/after expiry, terminal metadata consistency, and digest shape. A trigger rejects all content updates and proposal deletes. Content deletion is allowed only after the same transaction has inserted a `retention_disposed` event. A metadata trigger rejects changes to immutable columns.

Existing workspaces are backfilled with policy v1/`P1Y`; default eligibility is the database creation timestamp plus one calendar year. `createWorkspace` creates the default policy in its existing transaction. Existing `McpProposal` rows receive no backfill and its enum, indexes, routes, list responses, and web types remain unchanged.

### Lifecycle state machine

```text
                    expiresAt reached
pending ---------------------------------> expired (terminal)
   |                                          ^
   | dismiss before expiresAt                 | expiry wins at/after boundary
   v                                          |
dismissed (terminal)                          |

Any status -- valid successor exists --> current=false (status itself unchanged)
Any non-current row -- retention disposition --> content unavailable; tombstone retained
```

Get evaluates effective state at database now; list evaluates it at cursor `snapshotAt`, both using precedence `disposed > dismissed > expired > superseded > current`. A pending row is expired whenever evaluation time is at/after `expiresAt`, even before a sweeper materializes the event. Get synthesizes actor `system`, time `expiresAt`, and validity-expiration reason without writing; a sweeper later materializes exactly one event. `current` means pending, before expiry, not disposed, and no as-of successor.

Only one direct successor may reference a proposal. The partial/nullable unique database constraint on non-null `supersedes_id` is authoritative. Correction creation locks the predecessor and linearizes exact-identity lookup plus insert: an identical retry returns the committed successor, while a distinct payload finds an existing successor or loses the unique race and receives `409 SUPERSESSION_CONFLICT` without mutating either row. The predecessor must be currently authorized, retained, same contract/workspace/project/target, older than the new row, and have a distinct identity; an exact match to the predecessor returns it and cannot self-supersede.

Retention policy changes affect only future proposals. V1 exposes no automatic reevaluation path, so existing eligibility cannot silently shorten. Any future reevaluation must use the named audited event. The sweeper selects eligible non-current rows with `FOR UPDATE SKIP LOCKED`; in one transaction it inserts disposition audit, deletes content, and marks the tombstone. Failure rolls back all three and the row remains readable/retryable.

Housekeeping is leaderless and correctness does not depend on one process: each API instance runs an unref'ed expiry pass every 60 seconds (maximum 100 locked rows) and a retention pass every 24 hours (maximum 100 rows per transaction), with startup jitter. Multi-instance safety comes from row locks and unique events. Effective-status reads provide immediate expiry even if every worker is down; delayed retention only preserves content longer and raises metrics/logs, never deletes early.

### Explicit dismissal

Both MCP and API validate the reason before lookup by Unicode trim and code-point length `1..1000` (also bounded to 4,000 UTF-8 bytes); empty, whitespace-only, extra-key, or oversized input is 400 with no query/write. After current target visibility and member+ authorization, the API locks the proposal `FOR UPDATE` and uses database `clock_timestamp()` as the transition linearization time. No application work occurs between the conditional terminal update/event insert and commit.

- already dismissed: return 200 `already_dismissed` with the original actor/time/reason/client/correlation; ignore the retry reason and add no event;
- expired or transition time at/after `expiresAt`: materialize expiry once if needed and return 200 `already_expired`;
- disposed: return 200 `already_terminal` with only authorized tombstone/terminal metadata and no write;
- pending and pre-expiry, including a superseded-but-pending row: atomically set dismissed terminal metadata and insert exactly one `dismissed` event, returning 200 `dismissed`.

A partial unique terminal-event constraint and metadata trigger prevent reason replacement or a second terminal transition. Successful/repeated dismissal changes no content, Issue, ActivityLog, relation, notification, domain event, approval, or execution state. The response is bounded to 8 KiB so a 1,000-character original reason can be returned safely.

## Transactions and concurrency

| Operation | Boundary and locks | Commit rule |
|---|---|---|
| Bounded search/preview | Read-only `REPEATABLE READ`; local statement timeout; target and candidates from one snapshot | No domain write under any outcome |
| Validate host suggestions | Read-only transaction; re-read target/candidates and compare token bindings | Any target/source/scope mismatch fails or degrades as specified; no row |
| List page | Read-only `REPEATABLE READ`; project authorization first; fixed snapshot/source marker; `LIMIT limit+1` | No domain write; changed binding/auth/source fails rather than restarting |
| Persist | `SERIALIZABLE`; target/candidates and membership/project rows reauthorized and locked; predecessor `FOR UPDATE` when correcting; DB time once | Source/auth/location/policy/seal validation, identity/predecessor checks, insert, content and audits commit together |
| Exact dedup/correction | Identity lookup/insert plus unique non-null predecessor invariant; conflict paths re-read under the same linearization | Identical retry returns the original row/content; one distinct correction wins and the loser gets typed conflict; creation event only for an insert |
| Dismiss/expire | Validate reason, authorize, lock proposal `FOR UPDATE`, use DB transition time | Pre-expiry dismiss or at/after-expiry materialization; repeats return original terminal audit; exactly one event |
| Retention | `FOR UPDATE SKIP LOCKED`, batch bounded | Audit precedes content deletion in same transaction |
| Legacy apply rejection | Triage lookup and current authorization, then append `apply_rejected` audit | Never updates either proposal table or Issue; audit failure returns unavailable, still no mutation |

Serializable/deadlock failures (`P2034`/SQL serialization class) retry internally at most three times with bounded jitter. `P2002`/identity conflict is not an error; load the existing row after revalidating current source/visibility. A transport failure after commit is recovered by resubmitting the same sealed preview; uniqueness returns the committed record. MCP does not automatically retry non-401 POSTs and returns safe retry guidance.

Persistence validates **current** authorization and source for the target and every retained candidate before create, identity lookup, or dedup return. If source/policy changed after an earlier success, a live stale preview returns conflict; only an expired authentic seal may recover that already-committed exact identity, still subject to current authorization/source checks.

The current legacy apply route uses `requireProposalRole("id", "member")`, which resolves only `McpProposal` before its handler. For apply only, replace it with a dedicated triage-ledger-first resolver: query `TriageProposal`, then authorize its current target/member role before disclosure. A found-but-invisible triage ID returns the same not-found-or-not-visible result and never falls through. An authorized triage ID must append `apply_rejected` and return non-executable before any legacy lookup or status work; audit failure returns unavailable with no legacy or domain mutation. Only actual ledger absence invokes unchanged `McpProposal` authorization/status behavior. If the UUID exists in both tables, triage wins and apply fails closed. The legacy dismiss route keeps its current resolver; dedicated triage dismiss uses the new triage resolver.

## Authorization matrix

| Capability | Effective API authorization |
|---|---|
| Project preview/search | Viewer+ on target project; token must allow target project |
| Workspace-expanded search | Viewer+ workspace membership, only projects visible through owner/admin bypass or ProjectMember, intersected with token scope |
| Persist/supersede | Current target visibility and effective project role member+ |
| Project proposal list | Exactly one visible/token-allowed project, viewer+; current target visibility before all filtering/paging; rechecked every page |
| Proposal get/disposed lookup | Current target visibility and viewer+ |
| Proposal dismiss | Current target visibility and effective project role member+ on every attempt, including terminal retries |
| Policy configuration | Admin/owner at workspace/project boundary |
| Legacy triage apply attempt | Current target visibility/member+ before auditable non-executable rejection |

Authorization is re-evaluated before search/match/rank/projection, persistence and dedup return, every get/list page, lifecycle/supersession, and each retained-candidate projection under the bound authorization-policy version. Target loss yields the same 404 as absence; candidate loss redacts immutable stored key/text/evidence without an existence, omission, or count signal. Viewer write attempts return 403 only after target visibility is established. No error exposes hidden identities, counts, or cursor.

## Sequence diagrams

### Deterministic preview

```mermaid
sequenceDiagram
  participant H as MCP host
  participant M as MCP server
  participant A as API triage route
  participant S as Bounded search/policy
  participant D as PostgreSQL
  H->>M: kanon_preview_issue_triage(prepare, aiIntent=none)
  M->>A: POST /issues/:key/triage/preview + correlation
  A->>D: permission-safe target lookup
  A->>S: prepare in read-only deadline
  S->>D: authorized ranked query LIMIT 11
  D-->>S: max 11 internal rows
  S-->>A: deterministic findings + max 10 candidates
  A-->>M: compact preview + previewSeal
  M-->>H: <=16 KiB; no proposal ID
```

### Host-AI enriched preview

```mermaid
sequenceDiagram
  participant H as MCP host/model
  participant M as MCP server
  participant A as API
  H->>M: preview(prepare, aiIntent=host_assisted)
  M->>A: POST preview phase=prepare
  A-->>M: deterministic preview + contextToken + bounded evidence
  M-->>H: untrusted-data envelope
  Note over H: Host reasons; Kanon does not invoke Sampling
  H->>M: preview(validate, token, typed suggestions, model identity)
  M->>A: POST preview phase=validate
  A->>A: decrypt token; reauthorize/revalidate sources; strict schema/policy checks
  A-->>M: final validated preview + seal or deterministic degradation
  M-->>H: supported/unknown/conflict; no write
```

### Explicit persistence, dedup, and unknown-commit retry

```mermaid
sequenceDiagram
  participant H as Host
  participant A as API proposal service
  participant D as PostgreSQL
  H->>A: POST triage-proposals(preview, seal)
  A->>D: SERIALIZABLE; lock target/auth; revalidate source
  A->>D: INSERT proposal ON CONFLICT digest DO NOTHING
  alt inserted
    A->>D: INSERT content + created event (+ superseded event)
    D-->>A: commit id P1
  else concurrent/existing
    A->>D: SELECT P1 by digest
    D-->>A: original immutable P1
  end
  A--xH: response lost after commit
  H->>A: retry exact sealed request
  A->>D: revalidate source; conflict-safe insert/select
  A-->>H: P1, outcome=deduplicated
```

### Project review queue pagination

```mermaid
sequenceDiagram
  participant H as MCP host
  participant M as MCP server
  participant A as API list route
  participant D as PostgreSQL
  H->>M: kanon_list_triage_proposals(projectKey, filters, limit=20)
  M->>A: GET /projects/:key/triage-proposals + correlation
  A->>D: reauthorize project; REPEATABLE READ; snapshotAt
  A->>D: visible targets -> as-of state/filter -> ORDER -> LIMIT 21 + source marker
  D-->>A: 20 compact rows + lookahead
  A-->>M: returnedCount=20 + encrypted nextCursor
  M-->>H: compact page only
  H->>M: list(same bindings, nextCursor)
  M->>A: next page
  A->>D: reauthorize; recompute bound snapshot/source marker
  alt authorization/source changed
    A-->>M: 404 or 409; no silent restart
    M-->>H: semantic error + safe retry guidance
  else snapshot valid
    A-->>M: next keyset page; new proposals excluded
    M-->>H: compact page
  end
```

### MCP dismissal versus expiry

```mermaid
sequenceDiagram
  participant H as MCP host
  participant M as MCP server
  participant A as API dismiss route
  participant W as Expiry sweeper
  participant D as PostgreSQL
  H->>M: kanon_dismiss_triage_proposal(id, reason)
  M->>A: POST /triage-proposals/:id/dismiss + correlation
  A->>A: Unicode trim/length validation; member+ target authorization
  par race
    A->>D: BEGIN; SELECT proposal FOR UPDATE
    W->>D: BEGIN; SELECT proposal FOR UPDATE
  end
  A->>D: compare clock_timestamp() with expiresAt
  alt already dismissed
    A-->>M: original audit; no new event
  else transition time >= expiresAt
    A->>D: materialize one expired event
    A-->>M: already_expired
  else pending before expiry
    A->>D: dismissed + original actor/time/reason/client/correlation event
    A-->>M: dismissed
  end
  M-->>H: terminal result
  D-->>W: terminal state; no second event
```

### Rejected legacy apply

```mermaid
sequenceDiagram
  participant C as kanon_apply_proposal/web client
  participant R as Legacy apply route
  participant D as PostgreSQL
  C->>R: POST /api/proposals/:triageId/apply
  R->>D: triage-ledger-first lookup; reauthorize target/member; never fall through
  R->>D: INSERT apply_rejected audit only
  R-->>C: 422 TRIAGE_PROPOSAL_NON_EXECUTABLE
  Note over D: proposal status/content and Issue/ActivityLog/events unchanged
```

## Failure, degradation, and recovery matrix

| Condition | External result | Domain state | Recovery |
|---|---|---|---|
| Missing or invisible target/proposal/project | 404 not-found-or-not-visible | none | Check access/key without existence detail |
| Visible viewer attempts persist/dismiss | 403 authorization | none | Member+ must explicitly act |
| List requests workspace/multiple projects, unknown filter, or limit outside 1..50 | 400 validation before query | none | Supply one project and supported bounded filters |
| Invalid projection/search filter/token/cursor binding | 400 validation | none | Correct input; never clamp/widen |
| Search cursor population changed | 409 search source conflict | none | Restart search/preview |
| List cursor authorization lost | 404 not-found-or-not-visible | none | Restore access; no cursor/project details returned |
| List binding or snapshot/source marker changed | 400 binding mismatch or 409 list snapshot conflict | none | Restart from page 1 explicitly; never auto-restart |
| Disposed list row not policy-visible/default current request | Omitted before filter/order with no count signal | none | Authorized get, or explicit disposed/all when policy allows |
| Search statement timeout | Direct search 503; preview deterministic with `timed_out` candidate completeness | none | Retry preview; do not claim exhaustive candidates |
| Core target/policy source unavailable | 503 or source conflict | none | Retry with correlation ID |
| Host unavailable/timed out/invalid | 200 deterministic degraded success | none | Inspect typed reason; no provider switch |
| Prompt injection/tool request | Host item rejected/unknown; deterministic subset remains | none | Use visible evidence refs only |
| Output budget reached | 200 with `output_truncated` | none | Request bounded full tier or fewer optional items |
| Preview seal expired/tampered | Tampered: 400. Expired: dedup-recovery only; 400 if no exact committed row | none | Retry recovery or rerun preview for creation |
| Target changed/moved | 409 source conflict | no proposal/audit | Rerun preview |
| Target deleted/permission lost | 404 not-visible | no proposal/audit | Restore access or stop |
| Exact concurrent/retried persist | same proposal ID, created/deduplicated outcome | one row/content/creation event | Safe to retry |
| Serialization/deadlock | internal max-three retry, then 503 | atomic rollback | Caller retries same sealed request |
| Distinct correction race | one successor; loser 409 supersession conflict | one chain link | Read winner, then rerun if correction still needed |
| Empty/whitespace/>1000-character dismissal reason | 400 validation | none | Supply a trimmed bounded reason |
| Repeat dismissal with changed reason | 200 `already_dismissed` with original audit | no new event/content change | Treat as idempotent success |
| Dismiss at/after expiry or expiry wins lock | 200 `already_expired` | one expired event | Treat as terminal success; do not retry mutation |
| Concurrent pre-expiry dismissals | all return same dismissed terminal audit | one dismissed event/original reason | Safe idempotent result |
| Retention worker failure | unavailable operational log/metric | content retained, transaction rolled back | Next sweep retries |
| Disposed authorized read | 410 disposed tombstone, no content | audit retained | Use policy/time metadata |
| Legacy apply on triage | 422 non-executable; or 503 if rejection audit cannot commit | rejection audit only on 422; no status/content/Issue mutation | Never retry as apply; use read/dismiss only |
| Feature disabled | 503 capability disabled with safe guidance | none | Enable in rollout order |

## Observability

Use Fastify request IDs as correlation IDs. `app.ts` accepts a valid `X-Kanon-Correlation-ID` UUID or creates one, includes it in Pino `reqId`, returns it as a header/body, and threads it through MCP. The MCP client gains per-request timeout/correlation options; existing calls retain their 10-second default.

Extend the existing `plugins/metrics.ts` registry rather than using a second global prom-client registry. Proposed low-cardinality metrics:

- `kanon_triage_search_duration_seconds{scope,completeness,outcome}`;
- `kanon_triage_search_rows{measure}` histograms for logical rows scanned/evaluated after authorization and rows returned (`measure=logical_scanned|returned`);
- `kanon_triage_preview_duration_seconds{phase,outcome,ai_contributed}`;
- `kanon_triage_degradation_total{reason}`;
- `kanon_triage_proposal_requests_total{operation,outcome}` where bounded operations include persist/get/list/dismiss/expire/retain/rejected_apply;
- `kanon_triage_proposal_duration_seconds{operation,outcome}`;
- `kanon_triage_proposal_list_rows{state_filter}` histogram for returned authorized rows only.

No label contains query text, prompt/output, evidence, user/member, proposal, issue, project, workspace, cursor, or model string. Model/provider/version, policy version, stage durations, validation rejection class, and rows evaluated are structured trace-log fields under the correlation ID, not metric labels; model identity fields are bounded and never accompanied by prompt/evidence text. Add Pino redaction paths for preview/suggestion bodies as defense in depth and never explicitly log those bodies.

Creation provenance and lifecycle events are the durable audit. Dedup requests preserve original provenance and emit only request telemetry. List traces record page latency, returned rows, snapshot/cursor outcome and auth/source-conflict category without the cursor or counts beyond returned rows. Dismiss traces distinguish `dismissed|already_dismissed|already_expired|already_terminal`; the lifecycle row preserves the original reason. Rejected apply writes an append-only lifecycle audit but no domain event. Preview/list/get write no audit row.

## Performance contract

Reference profile `triage-preview-v1` is versioned and checked before enablement:

- PostgreSQL 16 and Node 20; API and database each limited to 4 vCPU/8 GiB; warm database; 1–5 ms API/MCP network;
- one workspace, 20 projects, 5,000 issues each (100,000 total); caller authorized for 10 projects (50,000), target project 5,000;
- title/key corpus includes exact, prefix, token-overlap, no-match, equal-rank, max labels, and descriptions at 2 KiB median/50 KiB maximum;
- project and workspace scope, 10 returned candidates, compact maximum recommendation set;
- concurrency 16, 100 warmups, at least 1,000 measured calls per path;
- deterministic `prepare`, host-completed `validate` with suggestions already supplied, reported host timeout, and candidate-query timeout cases.

Reference profile `triage-proposal-list-v1` uses the same runtime limits and adds one project with 25,000 triage proposals over 5,000 current/deleted/moved targets, all effective states, both disposition-discovery policies, all generator/degraded filters, duplicate creation timestamps, and deep keyset pages. It measures default 20 and maximum 50 rows, first/middle/final pages, changed authorization/source markers, and dismissal/retry/expiry races at concurrency 16 after 100 warmups with at least 1,000 measured calls per list/dismiss path.

Every accepted new MCP call must have P95 below 3 seconds; list has an engineering target below 1.5 seconds and dismissal below 1 second under that profile. Host reasoning between preview calls is outside Kanon's request and cannot hold an API/MCP call open. Serialized outputs are capped at 32 KiB for a 50-row list page, 64 KiB for proposal get, and 8 KiB for dismissal; list has no full tier and whole rows are never truncated—budget failure is temporary unavailability, not a partial page.

Deadline allocation for `prepare` is a 2,900 ms MCP hard timeout around a 2,500 ms API timeout. Inside the API: target/auth 250 ms, search statement timeout 900 ms, policy/optional context 500 ms, shaping/hash/size 300 ms, API reserve 550 ms. MCP reserves the remaining 400 ms for request/response transport, parse/serialization, and cancellation. `validate` allocates its 2,500 ms API budget as 700 ms reauthorization/source fetch, 500 ms validation/conflict resolution, 300 ms shaping, and 1,000 ms reserve; the same outer 400 ms remains. Optional context/search is cancelled or degraded before the core deadline; target/source/policy failure is not degraded into a false preview.

List uses a 2,900 ms MCP hard timeout around a 2,500 ms API budget: project authorization 250 ms, visibility/as-of filter plus source marker 1,200 ms, keyset page/projection 400 ms, serialization 200 ms, and 450 ms reserve. Dismiss uses a 2,000 ms MCP timeout around a 1,500 ms API budget with no retry after an unknown response beyond safe caller repetition.

Evidence required before enablement: preview plans proving authorized CTE + server `LIMIT 11` and no MCP full-list call; list plans proving project/target visibility precedes predicates and `LIMIT 51`, keyset/index use, and no content-table fetch; P50/P95/P99 for both profiles; compact preview <=16 KiB and list <=32 KiB; timeout/source-conflict behavior; and operator-only scanned versus returned measurements. If either profile fails, relevant flags remain off; limits, authorization, projection, and fixed ceilings are not relaxed.

## Strict-TDD verification strategy

Tests are written failing before each production slice and keep transaction boundaries observable.

| Layer | Required evidence mapped to specs |
|---|---|
| Pure unit | Search normalization/rank; source/canonical hashes; authorization-policy/source/scope binding for search/list cursors, tokens, seals and identity; state/projection; evidence/output; dismissal/lifecycle clocks |
| API service | Search authorization/timeout/limit+1; list visibility CTE before filters/digest/order and limit+1; list snapshot/new-row exclusion/source conflict; deterministic repeatability; zero-write preview/list/get spies |
| API integration/PostgreSQL | Search project/workspace/token matrix; proposal list missing/forbidden project parity, one-project-only validation, target visibility/cardinality invariance, all filters, 20/50 bounds, deep pages, expired/disposed policy, changed auth/source cursor conflict, projection privacy |
| Proposal integration | Current target/candidate auth on create/dedup/get/list; signal-free candidate redaction with stored-byte immutability; stale seal recovery; triggers, lifecycle, policy, disposal and generic compatibility |
| Concurrency | Parallel exact inserts/unknown commit; identical correction retry; distinct-payload successor race proves one non-null predecessor successor plus one typed conflict; dismissal/expiry/list/retention races; multi-worker `SKIP LOCKED` |
| Legacy security | Triage-ledger-first resolution, invisible-target no-fallthrough, UUID collision, audited pre-legacy rejection, audit-failure fail-closed; no legacy/Issue/ActivityLog/domain mutation; existing legacy apply unchanged |
| MCP contract | Exact five names/schemas/annotations; list requires one project/compact only; dismissal destructive+idempotent; REST paths, errors, fallback, output bytes, 49/26/23 counts, existing 44 regressions |
| Migration | Legacy upgrade; policy backfill; identity and unique non-null predecessor plus list/lifecycle indexes; checks/triggers/FKs; no Issue change; flags-off retained-row recovery; generic index unchanged |
| Performance | `triage-preview-v1` and `triage-proposal-list-v1`, max 10/50 paths, P95 <3s, list/dismiss targets, timeout/conflict and SQL-plan assertions |
| Observability/privacy | Correlation continuity; list returned-row/snapshot and dismiss terminal outcomes; no high-cardinality labels/body/cursor logs; no preview/list/get audit writes; lifecycle audit completeness |

Negative zero-write tests snapshot counts/hashes for Issue, `McpProposal`, triage ledger, ActivityLog, AdminAuditLog, comments, notifications, work records, relations, lifecycle events, and captured EventBus emissions before repeated prepare/validate/degraded preview and proposal get/list calls. Dismiss tests permit only one terminal metadata update plus one lifecycle event.

## Verified file and symbol impact map

Path verification outcome after the specification-revision audit: every existing path in this table was re-opened in the authoritative worktree; the named legacy migration and source symbols `McpProposal`, `Issue.updatedAt`, `Project.updatedAt`, `IssueFilterQuery`, `listIssues`, `ROLE_HIERARCHY`, `enforceProjectAccess`, `requireProposalRole`, `createWorkspace`, `DEFERRED_TOOLS`, `DESCRIPTION_BASELINE_BYTES` (verified current 5,300/ceiling 5,350 commentary), `BatchTransitionInputShape`, `kanon_batch_transition`, `registerCycleTools`, and `registerTimesheetTools` were confirmed. `@kanon/mcp` has no `@kanon/shared` runtime dependency and has no Sampling implementation. Only paths explicitly marked **NEW** do not exist yet; their parent directories were verified.

| Path | Impact |
|---|---|
| `packages/api/prisma/schema.prisma` | Add dedicated triage/policy models, list-summary fields/enums and queue indexes; only Workspace/Project back-relations, no Issue change |
| `packages/api/prisma/migrations/<timestamp>_mcp_large_team_readiness/migration.sql` | **NEW**: additive ledger/policy SQL, policy backfill, identity and unique non-null predecessor indexes, checks/immutability triggers; preserve verified legacy dedup migration |
| `packages/api/src/modules/issue/schema.ts` | Add bounded-search wire schema without changing `IssueFilterQuery` |
| `packages/api/src/modules/issue/service.ts` | Keep `listIssues` behavior; factor only safe shared filter helpers if semantics remain byte-compatible |
| `packages/api/src/modules/issue/routes.ts` | Mount target-anchored bounded search/preview routes or delegate to new plugin |
| `packages/api/src/modules/triage/` | **NEW** search, source identity/cursors, policy/preview, proposal create/get/project-list/dismiss services/routes, lifecycle/retention sweep |
| `packages/api/src/middleware/require-role.ts` | Add permission-safe triage target/proposal resolvers using existing `ROLE_HIERARCHY`/`enforceProjectAccess`; preserve other legacy gates |
| `packages/api/src/modules/mcp-proposal/routes.ts` | Replace only apply's current `requireProposalRole` pre-handler with triage-first dual resolution, non-executable rejection/audit, then unchanged legacy branch |
| `packages/api/src/modules/workspace/service.ts` | Create workspace default triage policy in existing workspace transaction |
| `packages/api/src/plugins/metrics.ts` | Register/inject low-cardinality triage metrics in the existing registry |
| `packages/api/src/app.ts` | Correlation request ID, triage routes, feature flags, bounded DB housekeeping registration |
| `packages/api/src/test/helpers.ts` | Cleanup/seed support for additive tables and policy defaults |
| `packages/mcp/src/tools/triage.ts` | **NEW** five deferred tools, strict list/dismiss schemas, annotations and compact transforms |
| `packages/mcp/src/index.ts` | Register five triage tools; existing registrations preserved |
| `packages/mcp/src/kanon-client.ts` | Preview/persist/get/project-list/dismiss methods, list cursor query encoding, per-call deadline/correlation |
| `packages/mcp/src/errors.ts` | Add versioned semantic errors/correlation without breaking existing error fields |
| `packages/mcp/src/types.ts` | Local MCP input schemas; no Prisma/API import |
| `packages/mcp/src/instructions.ts` and `packages/mcp/src/instructions.test.ts` | 23 deferred, 26 core, five triage names, compressed guidance, fixed 1,950-byte ceiling |
| `packages/mcp/src/tools/descriptions.test.ts` and `packages/mcp/src/tools/__tests__/baseline.fixture.ts` | Exact 49/26/23 count commentary; unchanged 5,350-byte ceiling and 50-byte floor, no re-anchor |
| `packages/mcp/src/tools/capture.ts`, `groups.ts`, `cycles.ts`, `timesheet.ts` | Measured compensating description trims while preserving firing pins/established contracts; clarify legacy apply excludes triage |
| `docs/modules/mcp.mdx` and `packages/mcp/agents/kanon.md` | 49-tool inventory, host protocol, project review queue, dismissal, fallback/non-executable guidance |
| `packages/shared/package.json`, `packages/shared/src/index.ts`, `packages/shared/src/issue.ts` | Inspected; intentionally unchanged |
| `packages/web/src/types/proposal.ts`, `packages/web/src/features/inbox/proposal-row.tsx`, `packages/web/src/features/inbox/use-dashboard-query.ts` | Inspected; intentionally unchanged because dedicated triage rows never enter legacy lists/UI Apply controls |

## Delivery slices and review workload

This design forecasts multiple chained, independently gated PRs; a single implementation PR would exceed the 800-line review budget. Do not create `tasks.md` here.

1. **Pure contract foundation:** canonicalization, source identity, cursor, schemas, unit tests.
2. **Bounded search API:** authorization CTE, route, cursor/deadline, security/integration tests.
3. **Read-only preview:** deterministic policy, host validation, output budgets, zero-write and MCP preview contract.
4. **Additive ledger migration:** dedicated models, policy backfill, triggers, migration/upgrade tests; flags off.
5. **Persistence/get/lifecycle:** serializable dedup, supersession, expiry/retention, get route, concurrency tests.
6. **Project review + dismissal:** visibility-first list query/cursor/index evidence, explicit terminal dismissal and race tests.
7. **Legacy isolation + five MCP tools:** deploy apply guard before enabling writes; exact counts/budgets and compatibility tests.
8. **Observability/performance/docs:** both reference profiles, registry metrics, canary instructions and verified 49-tool inventory.

Each slice keeps production and tests together, targets less than 800 changed review lines where practical, and cannot enable persistence until migration, source-conflict, concurrency, and legacy-apply tests are green.

## Migration, rollout, and rollback

Pre-enable and re-enable are objective: 100% of required build, generation, test, security, concurrency—including the distinct-payload successor race—and performance assertions must pass. Operator-approved canaries use rolling five-minute windows with at least 100 completed requests per stage: unexpected stage errors above 1% page and disable that stage; typed degradation above 10% pages and halts that stage; unexpected errors above 5% page incident command and disable all triage flags. Any security or invariant violation stops all triage flags immediately. Preview P95 under the reference load remains below three seconds as an independent gate; alerts only page or disable exposure and never mutate issues, proposal bytes, or audit.

Deployment order:

1. deploy additive schema/policy backfill and verify triggers/indexes; no routes use it;
2. deploy API with triage apply guard and `TRIAGE_PREVIEW_ENABLED=false`, `TRIAGE_PROPOSALS_ENABLED=false`;
3. deploy MCP 49-tool build with preview/proposal/review flags still disabled or internal-canary only;
4. enable preview for canary instances; verify zero writes, P95, 16 KiB, authorization and degradation;
5. enable get/project-list read paths after `triage-proposal-list-v1` visibility, cursor, 32 KiB and P95 evidence passes;
6. enable persistence and dismissal only after dedup, terminal-idempotency, expiry-race, migration and legacy-guard tests pass;
7. enable retention sweeps last and verify dry eligibility/disposed-list policy through operator-only telemetry.

Rollback is flags-off and fix-forward: disable proposal creation first, then list/preview as needed, while retaining immutable rows, audit, guards, authorized recovery paths, tombstones, and additive tables; MCP may temporarily return to 44 tools. Do not down-migrate enums/tables or delete audit rows during ordinary recovery. Existing generic proposal routes/data, web behavior, Issue rows, and all old MCP tools continue operating. Destructive rollback requires separate approval only after export/backfill and verification prove preserved history and compatibility.

## Design completion checklist

- [x] Every normative domain has a component, contract, transaction, failure, and test boundary.
- [x] Host model invocation is capability-safe and has a deterministic no-Sampling path.
- [x] Search, ranking, persistence, get/list, and retained-candidate projection all enforce current authorization and authorization-policy bindings before disclosure.
- [x] Proposal storage is dedicated, immutable, authorization-safe in projection, seven-day valid, one-year retained by default, exactly deduplicated with one successor per predecessor, and non-executable.
- [x] No Issue migration or domain mutation is introduced.
- [x] Exact inventory is 49 tools with 23 deferred and unchanged fixed description/instruction ceilings.
- [x] Proposal discovery is one-project, compact-only, visibility-first and snapshot-paginated; dismissal is explicit, terminal-idempotent and Issue-safe.
- [x] Rollout is guard-first with 100%-green and immediate-stop gates; flags-off recovery retains ledger, audit, and the apply guard for fix-forward repair.

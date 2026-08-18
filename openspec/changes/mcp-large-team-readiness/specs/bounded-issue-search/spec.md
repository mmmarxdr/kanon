# Bounded Issue Search Specification

## Purpose

Provide a reusable, permission-safe issue search and projection contract that bounds server work and returned data before MCP receives it.

## Terms

- **Project scope** is the target issue's project and is the default candidate pool.
- **Authorized workspace expansion** is an explicit request for the visible target issue's workspace. It requires current `viewer+` membership (the existing project-role hierarchy at or above `viewer`) in included projects; the pool is the intersection of those memberships and token-authorized projects. There is no special hidden workspace-search role, and it never means cross-workspace search.
- **Source version** is an opaque revision token for an observed issue snapshot. **Source hash** is a canonical digest of the bounded source fields represented by that snapshot. Both remain stable for the same snapshot and change when a persisted field represented by the snapshot changes.
- **Completeness** is exactly one of `complete`, `bounded`, `timed_out`, or `degraded`: `complete` means every authorized match was considered and returned; `bounded` means the limit stopped an otherwise healthy search; `timed_out` means the search deadline stopped evaluation; `degraded` means another named dependency or data-quality failure prevented complete evaluation.

## Requirements

### Requirement: Permission-safe search scope

The system MUST search only the target project unless the caller explicitly requests authorized workspace expansion. Workspace expansion MUST identify one workspace, MUST include only issue-visible projects allowed by the caller's token, and MUST return no more than the request-wide limit across all included projects. The system MUST reject cross-workspace scope.

Authorization MUST be applied before candidate matching, ranking, counting, projection, and completeness are determined. Forbidden issues and projects MUST NOT affect returned candidates, order, cursor availability, counts, completeness, or error details. The effective scope returned to the caller MUST describe only authorized scope and MUST NOT enumerate excluded or forbidden projects.

#### Scenario: Project scope is the default

- GIVEN a visible target issue in project A
- AND the caller does not request workspace expansion
- WHEN bounded search runs
- THEN only authorized issues in project A are eligible
- AND issues in other projects do not affect results or metadata

#### Scenario: Explicit workspace expansion is authorized

- GIVEN the caller explicitly names the target issue's workspace
- AND the caller is authorized for workspace-scale search
- AND the token permits projects A and B in that workspace
- WHEN bounded search runs with a limit of 10
- THEN authorized issues from A and B MAY be returned
- AND at most 10 issues are returned in total, not per project
- AND the response identifies workspace scope without listing inaccessible projects

#### Scenario: Workspace expansion fails closed

- GIVEN a caller requests a missing, foreign, or unauthorized workspace
- WHEN authorization is evaluated
- THEN the request fails with a permission-safe authorization result
- AND no candidates, counts, cursors, workspace existence detail, or excluded-project detail are returned

#### Scenario: Forbidden issues create no ranking side channel

- GIVEN two callers have the same access to project A
- AND only one caller can also access hidden project B
- WHEN both perform project-scoped search on A with identical inputs
- THEN their project-A candidates, ranks, cursor metadata, and completeness are identical
- AND hidden project B contributes no omission count or existence clue

### Requirement: Server-enforced query, projection, and limits

The server MUST NFKC-normalize query text, accept at most 12 tokens and 256 UTF-8 bytes, apply authorization, allowlisted equality/set filters (`state`, `type`, `priority`, `group`, `assignee`, `cycle`, `label`), deterministic ranking or sort, field projection, and limit before returning issue rows, and enforce a configured server deadline within the 3-second end-to-end budget plus database statement timeout. A request limit MUST be an integer from 1 through 10; the default MUST be 10. The target issue MUST be excluded before matching/ranking/limit; zero matches MUST return 0 rows with `complete` only after exhaustive healthy evaluation, otherwise completeness MUST reflect timeout or degradation. Invalid filters, projections, or limits MUST fail validation rather than being widened or silently ignored.

The default projection MUST be exactly the compact allowlist of issue id/key, project id/key, title, status, type, priority, labels, scalar group/assignee/cycle references (no nested objects or arrays), bounded created/updated times, `sourceVersion`, and `sourceHash`. It MUST exclude full descriptions and unrelated identity data. Any larger projection MUST be explicitly requested, server-allowlisted, authorization-checked, and bounded. Returned fields MUST be identical whether the search is called directly or through MCP.

#### Scenario: Maximum limit is enforced before return

- GIVEN more than 10 authorized issues match a query
- WHEN the caller requests limit 10
- THEN the server returns at most 10 projected rows
- AND completeness is `bounded`
- AND MCP does not receive the remaining issue collection

#### Scenario: Invalid limit is rejected

- GIVEN a caller requests a limit of 0 or greater than 10
- WHEN the server validates the request
- THEN it returns a validation failure
- AND it does not broaden, clamp, or execute the query

#### Scenario: Compact projection protects sensitive text

- GIVEN matching issues contain descriptions and user identity data
- WHEN the caller uses the default projection
- THEN full descriptions and unrelated identity fields are absent
- AND every returned field belongs to the documented compact allowlist

#### Scenario: Unauthorized projection fails closed

- GIVEN a caller requests a projection containing a field they may not read
- WHEN projection authorization is evaluated
- THEN the request fails with a permission-safe authorization or validation result
- AND the field is not returned for any row

### Requirement: Stable order, cursor, and source identity

For a fixed authorized scope, normalized query, filters, policy version, and source snapshot, the server MUST populate the authorized candidate population under `REPEATABLE READ` and compute a source fingerprint (canonical digest of authorized bounded rows and ordering inputs), then return the same deterministic server ranking/order. Ordering and ranking policy versions are part of that snapshot. Every row MUST include a unique stable issue reference, a one-based rank within the response, `sourceVersion`, and `sourceHash`. Ties MUST be resolved by a stable unique issue identity so retries cannot reorder equal-ranked rows.

A healthy `bounded` response MUST include a continuation cursor, while `complete` MUST NOT. A cursor MUST be opaque and bind the normalized query, filters, effective-scope/auth digest, authorization policy version, projection, target issue, ordering contract/version and ranking-policy version, seek tuple, and population source fingerprint. It MUST NOT encode readable issue or workspace data. A cursor used with different bound inputs MUST fail validation. A `timed_out` or `degraded` response MAY include a cursor only when consistent continuation is guaranteed. If source changes make consistent continuation impossible, the request MUST return a source-conflict result rather than silently skipping, duplicating, or reordering rows.

#### Scenario: Retry preserves order

- GIVEN the authorized data and all bound request inputs are unchanged
- WHEN the same search is retried
- THEN the issue references, ranks, source versions, source hashes, and cursor are stable

#### Scenario: Stable tie-break resolves equal scores

- GIVEN two authorized issues have the same primary rank score
- WHEN search orders the candidates
- THEN their relative order is determined by stable unique issue identity
- AND repeated calls do not swap them

#### Scenario: Cursor cannot be replayed under broader scope

- GIVEN a cursor was issued for project scope
- WHEN it is supplied with workspace scope or a different projection or query
- THEN validation fails
- AND no broadened result or scope detail is returned

#### Scenario: Concurrent source change invalidates continuation safely

- GIVEN a cursor is bound to a source snapshot
- AND an issue change prevents consistent continuation
- WHEN the cursor is used
- THEN the system returns a source-conflict result
- AND it does not silently restart the search or mix snapshots

### Requirement: Explicit completeness and degradation

Every successful search response MUST contain exactly one completeness value, the applied limit, returned-row count, effective authorized scope, ordering contract version, correlation identity, and zero or more typed degradation reasons. `timed_out` MUST name the exceeded deadline. `degraded` MUST identify the unavailable dependency or data class without exposing forbidden resources. `complete` MUST NOT be reported when matching evaluation was cut short.

Rows returned from a timed-out or degraded search MUST still satisfy authorization and projection rules. The response MUST NOT claim that partial rows are the complete top-ranked set. If no trustworthy authorized subset can be returned, the system MUST return a temporary-unavailability result rather than an empty `complete` result.

#### Scenario: Healthy result is complete

- GIVEN all authorized matches fit within the limit
- AND all required search dependencies complete
- WHEN search returns
- THEN completeness is `complete`
- AND no degradation reason is present

#### Scenario: Deadline returns explicit partial state

- GIVEN the search deadline expires after some valid rows are evaluated
- WHEN those rows can be returned safely
- THEN completeness is `timed_out`
- AND the deadline degradation reason is present
- AND the response does not claim complete ranking

#### Scenario: Core search failure is not a false empty result

- GIVEN no trustworthy candidate evaluation can complete
- WHEN search fails
- THEN the system returns temporary unavailability with correlation identity
- AND it does not return an empty result marked `complete`

### Requirement: MCP uses the bounded server contract

Any MCP search or triage capability using candidate retrieval MUST call the bounded server contract and MUST NOT obtain a full project or workspace issue collection and then apply search, projection, ranking, offset, cursor, or limit locally. Triage MUST consume only the first bounded page (maximum 10); a reusable search cursor MUST NOT let one preview accumulate pages. Existing `kanon_list_issues` inputs and outputs MUST remain compatible, and its scope MUST NOT be silently broadened.

#### Scenario: MCP candidate retrieval is server bounded

- GIVEN a workspace contains more issues than the requested limit
- WHEN MCP requests triage candidates
- THEN the API request carries the normalized query, projection, scope, cursor, and limit
- AND the API response contains at most that limit
- AND no preceding MCP call fetches the complete issue collection

#### Scenario: Existing list caller remains compatible

- GIVEN an existing caller uses `kanon_list_issues` with a previously valid input
- WHEN this capability is introduced
- THEN the call remains valid with its established output semantics
- AND it does not gain workspace-wide visibility by default

### Requirement: Search diagnostics do not require dedicated telemetry

The search contract MUST NOT require dedicated triage metrics, stage traces, or alerts. Existing platform request logging MAY carry a correlation identity, but it MUST use existing authorization and redaction controls and MUST NOT record search text, evidence text, or domain identifiers for triage-specific inspection. Caller-visible responses and diagnostics MUST NOT expose rows scanned, forbidden counts, or hidden-resource cardinality.

#### Scenario: Search adds no dedicated triage telemetry

- GIVEN an authorized preview or persistence request runs
- WHEN the request is processed
- THEN no dedicated triage metric, stage trace, or alert is required
- AND existing request logs contain no search text, evidence text, or domain identifier added for triage telemetry

#### Scenario: Caller cannot infer hidden cardinality

- GIVEN inaccessible issues were excluded before matching
- WHEN the caller inspects the response and error metadata
- THEN only returned authorized row count is visible
- AND scanned, excluded, and forbidden counts are absent

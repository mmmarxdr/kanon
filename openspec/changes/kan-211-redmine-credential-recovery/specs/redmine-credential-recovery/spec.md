# Redmine Credential Recovery

## Purpose
401 recovery: fence, blocked work, replace+redrive, redacted UX. After KAN-209 #248. No schema.

## Requirements

### Requirement: 401-only version fence

MUST treat HTTP 401 as auth failure outbound+inbound. MUST NOT treat 403/other terminal failures as invalidation. MUST classify 401 on error or `ProviderDispatchError.cause` only (no message parsing). MUST snapshot credential id + `lastValidatedAt` before I/O; CAS-invalidate on 401 while `valid`. Late old-key 401 MUST NOT invalidate newer key; CAS miss MUST retry; invalid credentials MUST NOT be reused. Invalidation MUST commit when lease stale; stale-owner transitions best-effort—MUST NOT roll back credential truth or escape inbound polling.

#### Scenario: Outbound 401
- GIVEN valid-credential outbound work
- WHEN top-level 401
- THEN `invalid`; not reused

#### Scenario: Wrapped observation 401
- GIVEN GET 401 in `ProviderDispatchError.cause`
- WHEN classified
- THEN auth failure; `invalid`

#### Scenario: Inbound 401
- GIVEN valid service-credential poll
- WHEN 401
- THEN `invalid`; later claims skip it

#### Scenario: 403 not auth
- GIVEN 403 response
- WHEN classified
- THEN status unchanged

#### Scenario: Late 401 race
- GIVEN key A in flight; key B validated before A 401
- WHEN A 401
- THEN B stays `valid`; work retries

#### Scenario: Outbound stale lease
- GIVEN 401 after work lease reclaimed
- WHEN CAS invalidates
- THEN `invalid` commits; work transition best-effort

#### Scenario: Inbound reclaimed lease
- GIVEN poll lease reclaimed before 401
- WHEN invalidated
- THEN cycle stops; no escape

### Requirement: Auth-blocked work

Definitive 401 MUST mark work `dead` with `skippedReason` `credential_invalid`, retaining id, `dedupeKey`, `correlationId`, operation, payload, actor, attempts. Uncertain-create or reconciliation 401 MUST stay `ambiguous` auth-blocked (no busy claiming) and MUST NOT become `dead`/`retry` redriving create. Already-`invalid` targets block without I/O. Missing/revoked/cross-workspace/actor-mismatch keep existing skipped semantics (not `credential_invalid`).

#### Scenario: Rejected create
- GIVEN definitive create 401, no remote ref
- WHEN rejected
- THEN `dead`/`credential_invalid`

#### Scenario: Ambiguous auth block
- GIVEN `ambiguous` reconciling uncertain create
- WHEN 401 in reconciliation
- THEN stays auth-blocked `ambiguous`; no create redrive

#### Scenario: Already-invalid
- GIVEN `invalid` credential target
- WHEN prepared
- THEN no I/O; blocked

### Requirement: Validated replace+redrive

`whoAmI` before save; fail → zero writes. Success atomically `valid` + redrive: `credential_invalid` `dead`→`retry`; `ambiguous`→`ambiguous` now (reconcile only). Preserve `dedupeKey`/`correlationId`/refs; no dupes. Other-reason `dead` MUST NOT requeue. Personal replace recovers personal work; admin service replace recovers service+inbound; user work stays on initiating member credential.

#### Scenario: Personal replace
- GIVEN invalid member cred; blocked dead+ambiguous
- WHEN valid replace
- THEN `valid`; dead retries; ambiguous reconciles

#### Scenario: Failed replace
- GIVEN invalid cred + blocked work
- WHEN `whoAmI` fails
- THEN invalid; no redrive

#### Scenario: Admin replace
- GIVEN invalid service cred; admin
- WHEN valid replace
- THEN valid; service work + inbound resume

#### Scenario: Ambiguous resume
- GIVEN auth-blocked `ambiguous` create
- WHEN redrive after replace
- THEN `ambiguous` now; reconcile; no dupe

### Requirement: Health and remediation UX

Expose service credential status + auth-blocked sync. Admins/owners: total + ≤20 local auth-blocked records. Members: safe blocked state, no cross-user detail. Owners: personal replace; admins: service replace despite discovery 401.

#### Scenario: Member blocked
- GIVEN invalid service cred
- WHEN member views settings
- THEN blocked message; no secrets

#### Scenario: Owner remediation
- GIVEN invalid personal cred
- WHEN owner views settings
- THEN replace offered

#### Scenario: Operator blocked work
- GIVEN auth-blocked work
- WHEN admin/owner reads health
- THEN total + ≤20 `credential_invalid` records

#### Scenario: Replace sans discovery
- GIVEN invalid service key; discovery 401
- WHEN admin opens UI
- THEN replace form available

### Requirement: Secret-safe observability

Logs, durable reasons, API, UI MUST NOT leak API keys, ciphertext, auth headers, raw provider bodies. MAY expose ids, 401, `credential_invalid`.

#### Scenario: Redacted evidence
- GIVEN credential material in error
- WHEN logged/exposed
- THEN no secrets; ids ok

# Redmine Credential Recovery

## Purpose
HTTP 401 recovery: version fence, blocked work, replace+redrive, redacted UX. Apply after KAN-209
PR #248. `pm-integration-*` absent from `openspec/specs/` (no partial MODIFIED). No Prisma schema
(KAN-210).

## Requirements

### Requirement: 401-only version fence

MUST treat HTTP 401 as auth failure for outbound+inbound (parity). MUST NOT treat 403/other terminal failures as credential invalidation. MUST snapshot credential id + `lastValidatedAt` before I/O and CAS-invalidate on 401 only while
that version remains `valid`. Late old-key 401 MUST NOT invalidate a newer validated key; CAS miss
MUST retry. MUST NOT reuse invalidated credential.

#### Scenario: Outbound 401
- GIVEN outbound work with valid credential version
- WHEN Redmine returns 401
- THEN version is `invalid` and not reused

#### Scenario: Inbound 401
- GIVEN inbound poll with valid service credential
- WHEN Redmine returns 401
- THEN version is `invalid`; later claims MUST NOT select it

#### Scenario: 403 not auth
- GIVEN Redmine returns 403 for credential
- WHEN classified
- THEN status unchanged

#### Scenario: Late 401 race
- GIVEN key A in flight; key B validated before A 401
- WHEN A returns 401
- THEN key B stays `valid`; work retries

### Requirement: Auth-blocked work

Outbound 401 MUST mark work `dead` with `skippedReason` `credential_invalid`, retaining id,
`dedupeKey`, `correlationId`, operation, payload, actor, attempts. Already-`invalid` targets MUST
block without I/O. Missing/revoked/cross-workspace/actor-mismatched credentials MUST keep existing
skipped semantics (not `credential_invalid`).

#### Scenario: Rejected create
- GIVEN durable create with no remote ref
- WHEN credential gets 401
- THEN `dead`/`credential_invalid`; identity unchanged

#### Scenario: Already-invalid
- GIVEN work targets `invalid` credential
- WHEN prepared
- THEN no provider request; stays queryable blocked

### Requirement: Validated replace+redrive

Replacement MUST pass Redmine `whoAmI` before save; failed validation MUST mutate nothing. Success
MUST atomically save as `valid` and requeue matching `credential_invalid` dead work without losing
durable identity (MUST NOT duplicate Redmine issues when refs/dedupe exist). Other-reason dead MUST
NOT requeue. Personal replace recovers personal work; admin service replace recovers service work +
inbound. User work MUST stay on initiating member credential.

#### Scenario: Personal replace
- GIVEN invalid member credential with blocked work
- WHEN replacement passes `whoAmI`
- THEN `valid` with new timestamp; matching work retries; other dead stays

#### Scenario: Failed replace
- GIVEN invalid credential with blocked work
- WHEN validation fails
- THEN stays invalid; no requeue

#### Scenario: Admin replace
- GIVEN invalid service credential; instance admin in workspace
- WHEN valid service replacement submitted
- THEN service credential valid; service work + inbound resume

#### Scenario: No duplicate create
- GIVEN auth-blocked create retains `dedupeKey`/`correlationId`/refs
- WHEN redriven after recovery
- THEN MUST NOT duplicate create for local identity

### Requirement: Health and remediation UX

Health MUST expose service credential status and auth-blocked sync. Admins/owners MUST get total + ≤20 recent auth-blocked records (local metadata only). Members MUST see safe blocked state (no cross-user details). Owners MUST get personal replace UX; admins MUST get service replace even if discovery 401.

#### Scenario: Member blocked
- GIVEN invalid service credential
- WHEN regular member views settings
- THEN sync blocked until admin reconnects; no secrets/cross-user details

#### Scenario: Owner remediation
- GIVEN caller personal credential invalid
- WHEN viewing settings
- THEN key rejected; replace offered

#### Scenario: Operator blocked work
- GIVEN auth-blocked work exists
- WHEN admin/owner reads connection health
- THEN total + ≤20 recent local records reason `credential_invalid`

#### Scenario: Replace sans discovery
- GIVEN service key invalid; discovery 401
- WHEN instance admin opens admin UI
- THEN replace form available without discovery success

### Requirement: Secret-safe observability

Logs, durable reasons, API, and UI MUST NOT contain API keys, ciphertext, auth headers, or raw
provider bodies. MAY include credential/work IDs, provider, status 401, `credential_invalid`.

#### Scenario: Redacted evidence
- GIVEN error/context contains credential material
- WHEN logged and exposed via health
- THEN no secrets in logs/reason/API/UI; IDs usable

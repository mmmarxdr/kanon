# Design: External PM Integrations

KAN-180/181 remain; KAN-182 adds a transactional outbox. EventBus wakes workers only.

```
web -> API tx(issue+work+audit) -> DB claimant -> Redmine
poll -> claim/apply tx -> application/conflict -> cursor
```

## Decisions

| Choice | Rejected | Why |
|---|---|---|
| Provider-neutral `core/types.ts`; outbound `PmProviderAdapter`, separate `InboundSource`; field value is `omit|set(T)|clear(null)`, map/writability validated. | provider pull/inferred maps | deterministic directional mapping. |
| Connection has many bindings, each with remote project/maps/cursor. | one workspace map | projects differ. |
| `serviceCredentialId` remains KAN-181 nullable loose ID, checked in tx against same-connection credential. | new FK | preserves independent deletion; atomic replace; clear pauses bindings first. |
| Outbox is primary; scanner repairs missed rows only. | post-commit bus delivery | bus is in-memory/lossy. |
| Unproven Redmine create is conflict/manual. | blind retry/idempotency header | no generic Redmine guarantee. |

## Deterministic additive Prisma contract

Enums: `IntegrationLifecycle(draft,active,pausing,paused,disabled)`, `SyncDirection(outbound,inbound)`, `SyncOperation(create,update,delete,close)`, `SyncWorkState(queued,leased,retry,superseded,ambiguous,dead,done,skipped)`, `ActorKind(user,system,ai,remote)`, `CredentialAuthStatus(unknown,valid,invalid,revoked)`, `InboundApplicationState(claimed,applied,conflict,skipped)`, `ConflictState(open,resolved)`.

All new IDs are UUID/timestamps. Extend `IntegrationConnection`: `lifecycle @default(draft)`, `lifecycleEpoch Int @default(0)`, `serviceFallbackEnabled Boolean @default(false)`; existing connections backfill `draft`. Extend `MemberIntegrationCredential`: `lastValidatedAt DateTime?`, `lastAuthStatus CredentialAuthStatus @default(unknown)`, `revokedAt DateTime?`; coverage requires `valid`, non-revoked, fresh. Add relations `bindings[]`, `works[]`, `applications[]`, `conflicts[]` to parents.

| Model | Non-null fields; relations/onDelete; keys |
|---|---|
| `IntegrationProjectBinding` | `connectionId`,`projectId`,`remoteProjectId`,`readMap Json`,`writeMap Json`,`lifecycle @default(draft)`,`lifecycleEpoch Int @default(0)`,`cursorUpdatedAt?`,`cursorRemoteId?`,`pageToken?`,`pollLeaseToken?`,`pollLeaseUntil?`,`pollFence Int @default(0)`; connection/project `Cascade`; unique `(connectionId,projectId)`,`(connectionId,remoteProjectId)`; index `(lifecycle,pollLeaseUntil)`. |
| `IntegrationExternalIdentity` | `bindingId`,`memberId`,`remoteUserId`,`remoteLogin?`; binding/member `Cascade`; unique `(bindingId,memberId)`,`(bindingId,remoteUserId)`. Credential is auth only. |
| `IntegrationSyncWork` | `bindingId`,`entityType`,`entityId`,`direction`,`operation`,`sequence BigInt @default(autoincrement()) @unique`,`dedupeKey String @unique`,`laneKey String`,`actorKey String`,`actorKind`,`payload Json`,`correlationId String`,`state @default(queued)`,`attempts Int @default(0)`,`availableAt @default(now())`,`leaseToken?`,`leaseUntil?`,`fence Int @default(0)`,`epoch Int`,`authCredentialId?`,`refId?`,`marker?`,`skippedReason?`,`requestedStatus?`,`actualStatus?`; binding Cascade, credential/ref `SetNull`; indexes `(bindingId,laneKey,sequence)`,`(state,availableAt)`. |
| `IntegrationInboundApplication` | `bindingId`,`remoteEntityType`,`remoteId`,`remoteUpdatedAt`,`applicationKey String @unique`,`correlationId`,`state @default(claimed)`,`leaseToken?`,`leaseUntil?`,`fence Int @default(0)`,`refId?`,`workId?`,`outcome Json?`; binding Cascade, ref/work `SetNull`; unique `(bindingId,remoteEntityType,remoteId,remoteUpdatedAt)`. `correlationId=hash(tuple)`. |
| `IntegrationConflict` | `bindingId`,`kind`,`state @default(open)`,`localEvidence Json`,`remoteEvidence Json`,`workId?`,`refId?`,`applicationId?`; binding Cascade, all nullable FKs `SetNull`; index `(bindingId,state)`. |

`ExternalRef` gains `bindingId?`, `remoteUpdatedAt?`, `localVersion BigInt @default(0)`, `lastCorrelationId?`. Migration 1 relation is nullable for validated backfill; migration 2 makes it non-null with `onDelete:Restrict` and unique binding/entity/ref only after zero-unresolved proof. Binding deletion explicitly cleans/migrates refs first. New models require binding. No drops/renames.

## Corrective amendment — 2026-07-28: split A1.8

Failed A1.8 is replaced by two unwired, autonomous slices; A1.9 depends on A1.8b. This amendment is design-only. The current `tasks.md` is intentionally not implementation-authoritative: its old A1.8/A1.9 branch and dependency rows remain until the next `sdd-tasks` phase replaces them with this chain. No apply or implementation may start before that synchronization.

### Contracts and trust boundaries

`issue-mutation-contract.ts` defines non-generic `IssueMutationRow = Prisma.IssueGetPayload<{}>`, `IssueCaptureField = "title"|"description"|"state"|"assigneeId"|"cycleId"|"estimate"`, `IssueMutationDraft = {result: IssueMutationRow; capture: IssueCaptureIntent}`, and `IssueCaptureIntent = {bindingId,direction,operation,actorKey,actorKind,correlationId,fields,refId?,authCredentialId?,availableAt?,marker?}`. `fields` is a narrow field/value projection over exactly those six canonical scalar members, including `estimate`; it accepts no nested or arbitrary JSON graph. The intent excludes entity identity, epoch, correlation alias, and caller payload. The canonical payload is derived once as `{version:1,fields,issue:{key,title,description,state,assigneeId,cycleId,estimate,completedAt,updatedAt}}`; dates become ISO strings.

`canonicalizeIssueMutationDraft(unknown)` is the runtime boundary. It inspects exact own data descriptors, copies the known Issue scalar shape, clones valid `Date`s, canonicalizes only labels and Prisma JSON fields, derives and deep-freezes the payload exactly once, and returns detached values. Missing/extra/symbol/accessor properties, custom prototypes (including arrays), cycles, invalid dates, non-finite numbers, `undefined`, bigint, functions, and `PromiseLike` values reject deterministically. Caller objects are never read again after detachment. This narrow DTO admits ordinary Prisma Issue rows and makes arbitrary graphs/nested transaction promises structurally absent; only JSON leaves require bounded recursion.

`withIssueMutationTx(operation, database=prisma): Promise<IssueMutationRow>` has no caller-supplied `issueId`. It owns `transaction → await operation → canonicalize once → construct/inject capture identity → await captureIntegrationWorkTx`. The awaited operation must return an `IssueMutationDraft` whose `result` is the canonical persisted Issue row: create returns the row with the ID generated by the mutation, while update and transition return their persisted rows. A1.8b constructs `entityType:"issue"` and injects the sole entity identity as `entityId:detached.result.id`; no equality assertion between independent values is needed or possible. It copies canonical fields explicitly (no spread), forwards the exact detached canonical payload once to A1.7, and never re-reads caller-owned data. The mandatory awaited capture remains before the transaction operation returns. Thus JD-A-901/902 are enforced by ownership/API omission; R3-008/009 disappear because neither a caller graph nor caller payload survives across the capture await.

### Chained work units

| Unit | Branch → PR target | Files | Forecast / rollback |
|---|---|---|---|
| A1.8a contract | from `feat/pm-182-outbox`: `feat/pm-182-issue-contract` → `feat/pm-182-outbox` at clean baseline `de988c638acef374cebb86caac1c7996196f5eec` | `packages/api/src/modules/integrations/{issue-mutation-contract.ts,issue-mutation-contract.test.ts}` | 340 lines (130/150/60 source/test/evidence); rollback deletes both. |
| A1.8b transaction | from `feat/pm-182-issue-contract`: `feat/pm-182-issue-tx-seam` → `feat/pm-182-issue-contract` | `packages/api/src/modules/integrations/{issue-tx.ts,issue-tx.int.test.ts}` | 360 lines (90/210/60 source/test/evidence); rollback deletes both. |

Each forecast is comfortably below the 400-line chained-review threshold (700 lines combined); no size exception is permitted.

A1.9 `feat/pm-182-issue` targets `feat/pm-182-issue-tx-seam` and alone wires `createIssue`, `updateIssue`, and `transitionIssue` while preserving their full scalar Issue return used by routes and roadmap callers. It may not start until the next `sdd-tasks` artifact has replaced the old A1.8/A1.9 branch and dependency rows with this A1.8a → A1.8b → A1.9 chain; no apply may start before that synchronized artifact exists.

### Strict-TDD matrix

| Slice | RED tests | Inherited regressions |
|---|---|---|
| A1.8a pure | real Issue row/Dates/JSON accepted; detached mutation immunity; exact/frozen payload; estimate appears in the supported field/value projection and detached payload; reject every unsupported descriptor/prototype/value and thenable; type contract | `core/types.test.ts`; API type gate |
| A1.8b PostgreSQL | commit plus awaited capture; create-generated identity from returned `result.id`; update/transition identity from each returned persisted row; useful Date-bearing return; callback/canonicalization/A1.7 failure rollback; source-mutation race; non-zero epoch; caller cannot supply or redirect entity identity | `outbox.int.test.ts`, `backfill.test.ts` |

Strict-TDD cases must make the trust boundary executable: a create mutation generates its ID and capture receives that ID, update and transition each capture their returned row's ID without a pre-known duplicate parameter, estimate is projected and forwarded, and attempts to supply `issueId` or redirect `entityId` are rejected or unrepresentable before A1.7 capture.

No schema/migration/provider/worker/runtime/UI scope. Preserve uncommitted `feat/pm-182-tx` as evidence; future work starts at clean `de988c638acef374cebb86caac1c7996196f5eec`. Algorithms may be selectively re-derived against these contracts, never copied blindly.

## Unchanged replay, claims, and transport

Inbound keys remain remote tuples; claim/apply uses serializable re-read, token/fence, atomic audit/outcome, and advances cursors after terminal page outcomes. Lanes claim minimum sequence; safe pre-lease supersession only. Pause increments epoch and waits for leases; workers recheck active epoch before I/O. DB limits remain authoritative.

Transport remains `undici ^6` with bounded poll/page/overlap/lease/heartbeat/concurrency/timeout/debounce/attempt/retention/credential-fresh settings. Requests re-resolve, validate, and pin; redirects are off and secrets redacted. Other architecture, deployment, and rollback decisions remain unchanged.

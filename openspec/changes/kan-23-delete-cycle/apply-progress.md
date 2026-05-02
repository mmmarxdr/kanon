# Apply Progress: kan-23-delete-cycle

## Batch 1 — Phase A (Infrastructure)

- [x] A.1 Schema delta — `packages/api/prisma/schema.prisma` — commit `5451421`
- [x] A.2 Migration applied — file `packages/api/prisma/migrations/20260501233422_add_admin_audit_log/` — commit `5451421` (same as A.1)
- [x] A.3 Bridge type — `packages/bridge/src/types.ts` (Zod schema + inferred type) + barrel export in `packages/bridge/src/index.ts` — commit `c70d62f`
- [x] A.4 DomainEventType extended — `packages/api/src/services/event-bus/types.ts` (no web mirror needed — web uses string literals in addEventListener, no separate DomainEventType definition found) — commit `af4e7f9`
- [x] A.5 Mock harness extended — `packages/api/src/modules/cycle/service.test.ts` — commit `556fa2b`

## Deviations from spec

- **A.3 type location**: Design section 4 shows a plain `interface KanonCycleDeleteResult`. Batch instructions specify a Zod schema (`z.object(...)`). Added Zod schema + `z.infer<>` type to `packages/bridge/src/types.ts` (same file the design designates). Both the schema (runtime) and type (compile-time) are exported. This is the stronger form — compatible with the interface shape.
- **A.3 cycleName**: tasks.md A.3 lists fields `deletedCycleId`, `detachedIssueKeys`, `auditLogId`. Design section 8 explicitly adds `cycleName: string` as required for MCP format tier ack output. Schema follows design (source of truth) and includes `cycleName`.
- **A.4 web mirror**: Searched for `DomainEventType` in web package — not found. Web's `use-domain-events.ts` registers listeners with bare string literals (`"issue.created"`, etc.). No mirror required.

## Verification

- `pnpm --filter @kanon/api test`: 372 passed / 1 skipped (28 test files) — after A.5
- `pnpm --filter @kanon/bridge test`: 208 passed (9 test files) — after A.3
- Typecheck `packages/api`: clean — after A.1, A.2, A.4
- Typecheck `packages/web`: clean — after A.4

## Next batch

Phase B — service TDD (16 tasks: B.1–B.16). Gated on Phase A green (confirmed above).

---

## Batch 2 — Phase B (Service TDD)

### Pre-step
- [x] B.0 Extract makeTxMock to shared helper — `packages/api/src/modules/cycle/__test-helpers__/tx-mock.ts` — commit `d182829`
  - Added `cycle.findUnique`, `cycle.delete`, `adminAuditLog.create` to the shared stub
  - Updated `service.test.ts` to import from the shared helper
  - Verified: 372 passed / 1 skipped (28 test files) — unchanged

### Tests + Implementation (combined — all 14 tests + impl + re-export)
- [x] B.1–B.15 All 14 service test scenarios + full deleteCycle implementation — commit `79b9c75`
  - B.1  REQ-CYCLE-DELETE-002 — active-state guard rejects unconditionally (even force:true) + no SSE emitted
  - B.2  REQ-CYCLE-DELETE-003 s1 — non-terminal issues + no force → AppError(400) with details.issueKeys
  - B.3  REQ-CYCLE-DELETE-003 s2 — force:true bypasses non-terminal guard
  - B.4  REQ-CYCLE-DELETE-003 s3 — only terminal issues, no force needed
  - B.5  REQ-CYCLE-DELETE-004 s1 + REQ-CYCLE-DELETE-005 — issue.updateMany called BEFORE cycle.delete, detachedIssueKeys correct
  - B.6  REQ-CYCLE-DELETE-004 s2 — empty cycle: updateMany still called, detachedIssueKeys=[]
  - B.7  REQ-AUDIT-LOG-001 s1 + REQ-AUDIT-LOG-002 — audit row with entityType/entityId/action/authorId/reason/payload shape, auditLogId in response
  - B.8  REQ-AUDIT-LOG-001 s2 — guard rejection → no adminAuditLog.create called
  - B.9  REQ-SSE-CYCLE-DELETED-001 s1 — cycle.deleted emitted post-commit with {cycleId, projectId}
  - B.10 REQ-SSE-CYCLE-DELETED-001 s2 — cycle.deleted emitted even for empty cycle
  - B.11 REQ-SSE-ISSUE-UPDATED-001 s1 — one issue.updated per detached key with fields:["cycleId"]
  - B.12 REQ-SSE-ISSUE-UPDATED-001 s2 — zero detached → no issue.updated emitted
  - B.13 fire-and-forget — eventBus.emit throws → service still resolves
  - B.14 REQ-CONCURRENCY-001 — Prisma P2025 caught outside tx → AppError(404, CYCLE_NOT_FOUND)
- [x] B.16 Re-export deleteCycle from cycle service barrel — commit `e05f1fe`

### Notable deviations / discoveries
- **AppError extended with optional `details` field**: The spec requires `CYCLE_HAS_NON_TERMINAL_ISSUES` to carry `details.issueKeys`. The existing `AppError(statusCode, code, message)` had no `details` parameter. Extended the constructor to accept an optional `Record<string, unknown>` fourth argument, and updated `error-handler.ts` to forward it in the HTTP response body. This is additive and backward-compatible — no existing tests broke.
- **P2025 mapping placement**: Correctly placed the `PrismaClientKnownRequestError` catch OUTSIDE the `prisma.$transaction(...)` callback, per design.md section 5 pitfall note.
- **workspaceId resolution**: Resolved via `project: { select: { workspaceId: true } }` inside the tx include (preferred design path).

### Files
- `packages/api/src/modules/cycle/__test-helpers__/tx-mock.ts` (NEW — shared tx stub)
- `packages/api/src/modules/cycle/delete-cycle.ts` (NEW — service implementation)
- `packages/api/src/modules/cycle/delete-cycle.test.ts` (NEW — 14 test scenarios)
- `packages/api/src/modules/cycle/service.test.ts` (REFACTORED — imports shared tx-mock)
- `packages/api/src/modules/cycle/service.ts` (EXTENDED — re-exports deleteCycle)
- `packages/api/src/shared/types.ts` (EXTENDED — AppError gains optional details param)
- `packages/api/src/plugins/error-handler.ts` (EXTENDED — forwards details in AppError responses)

### Verification
- `pnpm --filter @kanon/api test`: 388 passed / 1 skipped (29 test files)
- `cd packages/api && npx tsc --noEmit`: clean (no errors)

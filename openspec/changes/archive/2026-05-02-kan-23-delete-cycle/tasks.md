# Tasks: kan-23-delete-cycle

## Phase A — Infrastructure (schema + types, no behavior)

- [ ] A.1 [INFRA] Add `AdminAuditLog` model + `Member.adminAuditLogs[]` inverse relation to `packages/api/prisma/schema.prisma`
- [ ] A.2 [INFRA] Run migration: `pnpm --filter @kanon/api prisma migrate dev --name add-admin-audit-log` (creates `packages/api/prisma/migrations/<ts>_add-admin-audit-log/migration.sql` and regenerates Prisma client)
- [ ] A.3 [INFRA] Add `KanonCycleDeleteResult` interface to `packages/bridge/src/types.ts` — fields: `deletedCycleId: string`, `detachedIssueKeys: string[]`, `auditLogId: string`, `cycleName: string` (design section 8 requires `cycleName` for MCP format tier)
- [ ] A.4 [INFRA] Extend `DomainEventType` union with `"cycle.deleted"` in `packages/api/src/services/event-bus/types.ts`
- [ ] A.5 [INFRA] Add `DeleteCycleShape` Zod object to `packages/mcp/src/types.ts` — fields: `cycleId` (uuid), `force` (boolean optional), `reason` (string max 500 optional), `...WriteFormatField`

---

## Phase B — API Service (delete-cycle.ts) — Strict TDD

- [ ] B.1 [TEST] (REQ-CYCLE-DELETE-002) `deleteCycle` — active cycle rejected unconditionally even with `force: true` → `AppError(409, "CYCLE_ACTIVE")`, no audit row created, no SSE emitted — file: `packages/api/src/modules/cycle/delete-cycle.test.ts` (NEW)
- [ ] B.2 [TEST] (REQ-CYCLE-DELETE-003 s1, REQ-API-ERROR-001) `deleteCycle` — non-terminal issues present, `force` omitted → `AppError(400, "CYCLE_HAS_NON_TERMINAL_ISSUES")` with `details.issueKeys` — file: `packages/api/src/modules/cycle/delete-cycle.test.ts`
- [ ] B.3 [TEST] (REQ-CYCLE-DELETE-003 s2) `deleteCycle` — non-terminal issues present, `force: true` → guard does not fire, deletion proceeds — file: `packages/api/src/modules/cycle/delete-cycle.test.ts`
- [ ] B.4 [TEST] (REQ-CYCLE-DELETE-003 s3) `deleteCycle` — only terminal (`done`) issues, `force: false` → deletion proceeds without error — file: `packages/api/src/modules/cycle/delete-cycle.test.ts`
- [ ] B.5 [TEST] (REQ-CYCLE-DELETE-004 s1, REQ-CYCLE-DELETE-005) `deleteCycle` — happy path with done issues: `tx.issue.updateMany` called before `tx.cycle.delete`, `detachedIssueKeys` matches attached issues — file: `packages/api/src/modules/cycle/delete-cycle.test.ts`
- [ ] B.6 [TEST] (REQ-CYCLE-DELETE-004 s2) `deleteCycle` — cycle with zero attached issues: `tx.issue.updateMany` still called (zero rows), `detachedIssueKeys` is `[]`, no throw — file: `packages/api/src/modules/cycle/delete-cycle.test.ts`
- [ ] B.7 [TEST] (REQ-AUDIT-LOG-001 s1, REQ-AUDIT-LOG-002) `deleteCycle` — audit row created in tx with correct fields: `entityType: "cycle"`, `entityId`, `action: "delete"`, `authorId`, `reason`, `payload.cycleSnapshot` contains all listed cycle fields, `payload.detachedIssueKeys`, `payload.force`; returned `auditLogId` included in response — file: `packages/api/src/modules/cycle/delete-cycle.test.ts`
- [ ] B.8 [TEST] (REQ-AUDIT-LOG-001 s2) `deleteCycle` — guard rejection (active cycle) → `adminAuditLog.create` NOT called — file: `packages/api/src/modules/cycle/delete-cycle.test.ts`
- [ ] B.9 [TEST] (REQ-SSE-CYCLE-DELETED-001 s1) `deleteCycle` — emits exactly one `cycle.deleted` event post-commit with `{ cycleId, projectId }` — file: `packages/api/src/modules/cycle/delete-cycle.test.ts`
- [ ] B.10 [TEST] (REQ-SSE-CYCLE-DELETED-001 s2) `deleteCycle` — empty cycle (zero issues) still emits `cycle.deleted` — file: `packages/api/src/modules/cycle/delete-cycle.test.ts`
- [ ] B.11 [TEST] (REQ-SSE-ISSUE-UPDATED-001 s1) `deleteCycle` — emits one `issue.updated` per detached key with `fields: ["cycleId"]`, no events for unrelated keys — file: `packages/api/src/modules/cycle/delete-cycle.test.ts`
- [ ] B.12 [TEST] (REQ-SSE-ISSUE-UPDATED-001 s2) `deleteCycle` — zero detached issues → `issue.updated` NOT emitted — file: `packages/api/src/modules/cycle/delete-cycle.test.ts`
- [ ] B.13 [TEST] (REQ-SSE-CYCLE-DELETED-001 fire-and-forget) `deleteCycle` — `eventBus.emit` throws → service still resolves successfully with correct return value — file: `packages/api/src/modules/cycle/delete-cycle.test.ts`
- [ ] B.14 [TEST] (REQ-CONCURRENCY-001) `deleteCycle` — Prisma `P2025` error from `tx.cycle.delete` (concurrent race) is caught outside the tx and rethrown as `AppError(404, "CYCLE_NOT_FOUND")` — file: `packages/api/src/modules/cycle/delete-cycle.test.ts`
- [ ] B.15 [IMPL] Service skeleton + active-state guard + non-terminal guard + audit row + issue detach + cycle delete + post-commit SSE + P2025 mapping — new file `packages/api/src/modules/cycle/delete-cycle.ts`; add `workspaceId` via `project: { select: { workspaceId: true } }` include in tx (preferred design path); include `cycleName` in tx return for bridge type
- [ ] B.16 [INFRA] Re-export `deleteCycle` from `packages/api/src/modules/cycle/service.ts` for symmetry with existing service surface

---

## Phase C — API Route (DELETE /cycles/:id)

- [ ] C.1 [TEST] (REQ-AUTH-001 s3) Route — `DELETE /cycles/:id` with non-existent cycleId → `404 CYCLE_NOT_FOUND` from `requireCycleRole` preHandler before service is reached — file: `packages/api/src/modules/cycle/routes.test.ts`
- [ ] C.2 [TEST] (REQ-AUTH-001 s1) Route — caller with `viewer` role → `403` before service is invoked — file: `packages/api/src/modules/cycle/routes.test.ts`
- [ ] C.3 [TEST] (REQ-AUTH-001 s2) Route — caller with `member` role → `request.member.id` passed as `authorId` to `deleteCycle` — file: `packages/api/src/modules/cycle/routes.test.ts`
- [ ] C.4 [TEST] (REQ-API-RESPONSE-001) Route — successful delete → `200` with body `{ deletedCycleId, detachedIssueKeys, auditLogId }` — file: `packages/api/src/modules/cycle/routes.test.ts`
- [ ] C.5 [TEST] (REQ-API-ERROR-001) Route — service throws `CYCLE_ACTIVE` → `409` with body `{ error: { code: "CYCLE_ACTIVE", message: "..." } }` — file: `packages/api/src/modules/cycle/routes.test.ts`
- [ ] C.6 [TEST] (REQ-API-ERROR-001) Route — service throws `CYCLE_HAS_NON_TERMINAL_ISSUES` → `400` with `details.issueKeys` in error body — file: `packages/api/src/modules/cycle/routes.test.ts`
- [ ] C.7 [IMPL] Register `DELETE /cycles/:id` route in `packages/api/src/modules/cycle/routes.ts` — `requireCycleRole("id", "member")` preHandler, `DeleteCycleBody` Zod schema, calls `cycleService.deleteCycle`, `request.log.info({ cycleId, detachedCount, force }, "cycle deleted")` post-response, 200 reply with `KanonCycleDeleteResult` shape

---

## Phase D — MCP Tool (kanon_delete_cycle)

- [ ] D.1 [TEST] (REQ-CYCLE-DELETE-001 s1) MCP — `kanon_delete_cycle` registered with correct schema: `cycleId` (uuid required), `force` (boolean optional), `reason` (string max 500 optional), `format` (`WriteFormatField`) — file: `packages/mcp/src/tools/cycles.test.ts`
- [ ] D.2 [TEST] (REQ-CYCLE-DELETE-001 s2) MCP — `kanon_delete_cycle` called with `{ cycleId, reason }` → `client.deleteCycle(cycleId, { force: false, reason })` called exactly once — file: `packages/mcp/src/tools/cycles.test.ts`
- [ ] D.3 [TEST] (REQ-CYCLE-DELETE-001 s3) MCP — `ack` format (default) → response contains cycle name and count `"Deleted cycle … (N issues detached)"`, does NOT include `auditLogId` — file: `packages/mcp/src/tools/cycles.test.ts`
- [ ] D.4 [TEST] (REQ-CYCLE-DELETE-001 s4) MCP — `slim` format → response includes `detachedIssueKeys` list; `full` format → response includes `auditLogId` — file: `packages/mcp/src/tools/cycles.test.ts`
- [ ] D.5 [TEST] MCP — `kanon_delete_cycle` propagates `KanonApiError` as error result (error-handling parity with sibling tools) — file: `packages/mcp/src/tools/cycles.test.ts`
- [ ] D.6 [IMPL] Register `kanon_delete_cycle` tool in `packages/mcp/src/tools/cycles.ts` using `DeleteCycleShape` schema
- [ ] D.7 [IMPL] Add `KanonClient.deleteCycle(id, opts)` method to `packages/mcp/src/kanon-client.ts` — issues `DELETE /cycles/:id` with JSON body `{ force, reason }`, returns `KanonCycleDeleteResult`
- [ ] D.8 [IMPL] Add `formatCycleDelete(result, format)` helper to `packages/mcp/src/transforms.ts` — `ack`: `"Deleted cycle \"<name>\" (<n> issues detached)"`, `slim`: adds detached keys list, `full`: adds `cycleId` + `auditLogId`

---

## Phase E — Web SSE Handler (use-domain-events)

- [ ] E.1 [TEST] (REQ-WEB-CACHE-001 s1) Web — `cycle.deleted` SSE event → `queryClient.invalidateQueries({ queryKey: cycleKeys.all })` is called — file: `packages/web/src/hooks/__tests__/use-domain-events.test.tsx`
- [ ] E.2 [TEST] (REQ-WEB-CACHE-001) Web — `cycle.deleted` handler is registered exactly once per mount (no duplicate listener on re-render) — file: `packages/web/src/hooks/__tests__/use-domain-events.test.tsx`
- [ ] E.3 [IMPL] Add `cycle.deleted` event listener block to `packages/web/src/hooks/use-domain-events.ts` — `handleCycleEvent` invalidates `cycleKeys.all`; insert between existing "Project events" and "Member events" sections (around line 54)

---

## Phase F — Cross-cutting verification notes

- [ ] F.1 [TEST] (REQ-SSE-CYCLE-DELETED-001) Service test B.9 also asserts event shape `{ cycleId, projectId }` — verify the assertion checks the full payload, not just that emit was called — file: `packages/api/src/modules/cycle/delete-cycle.test.ts`
- [ ] F.2 [NOTE] REQ-CONCURRENCY-001 manual verification: document in PR body that Postgres `READ COMMITTED` + implicit row lock at `tx.cycle.delete` ensures only one concurrent tx commits; the loser receives `P2025` → `AppError(404, "CYCLE_NOT_FOUND")`. Cite proposal Decision C. No automated concurrent-tx test added (integration-test harness not set up for parallel-tx scenarios).
- [ ] F.3 [NOTE] Migration deploy order note in PR body: `prisma migrate deploy` must run before API restart; `admin_audit_logs` table must exist before Prisma client tries to use it. MCP and web tolerate absence of `cycle.deleted` events (additive changes).

---

## Phase G — Documentation

- [ ] G.1 [DOCS] Update `packages/mcp/skills/kanon-cycle/SKILL.md` "Tools at a glance" table — add `kanon_delete_cycle` row with description and key params (KAN-23 acceptance criterion 1)
- [ ] G.2 [DOCS] Add "Hard delete vs close" section to `packages/mcp/skills/kanon-cycle/SKILL.md` disposition guide — clarify that `kanon_delete_cycle` is permanent (no undo) vs `kanon_close_cycle` which ends the sprint cleanly; note `force` flag semantics and active-cycle refusal

---

## Phase H — Manual verification

- [ ] H.1 [MANUAL] Smoke test: delete one seeded placeholder cycle (e.g., Cycle 7) via `kanon_delete_cycle`; confirm `kanon_list_cycles` no longer returns it and audit row exists
- [ ] H.2 [MANUAL] Verify Velocity History chart updates correctly after deleting synthetic cycles (Cycles 7–11); confirm chart reflects real velocity only
- [ ] H.3 [MANUAL] Verify web Cycles screen invalidates and re-renders correctly after SSE `cycle.deleted` arrives (no crash when deleted cycle was selected)
- [ ] H.4 [CLEANUP] Resolve any TypeScript type errors, `// TODO` markers, or lint warnings introduced during implementation

---

```yaml
status: complete
executive_summary: >
  49 tasks across 8 phases for kan-23-delete-cycle. Strict TDD ordering enforced throughout
  Phases B-E: 14 service tests + 6 route tests + 5 MCP tests + 2 web tests precede their
  respective implementations. Infrastructure tasks (A.1-A.5) must complete before any service
  test can pass. Two design picks from design.md are encoded as defaults: workspaceId resolved
  via project include inside tx; cycleName added to KanonCycleDeleteResult for MCP format tiers.
artifacts:
  - /home/marxdr/workspace/kanon/openspec/changes/kan-23-delete-cycle/tasks.md
next_recommended: sdd-apply
risks:
  - Phase A.2 (migration run) must precede all service tests — Prisma client won't type-check
    adminAuditLog.create until the schema is regenerated; gate the first test commit on this
  - B.15 (service implementation) covers ~13 test cases at once — if the tx mock harness is
    complex to set up, split the test setup into a shared beforeEach helper to avoid duplication
    across 14 test cases in delete-cycle.test.ts
  - D.8 (formatCycleDelete) depends on cycleName being in the API response (A.3 bridge type +
    B.15 tx return); if that field is missing at apply time, the ack format test (D.3) will
    fail with a shape error rather than a format error — verify A.3 and B.15 first
skill_resolution: injected
```

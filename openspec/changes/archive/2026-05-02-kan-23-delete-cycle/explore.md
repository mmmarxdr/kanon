# Exploration: kan-23-delete-cycle

## Goal

Add `kanon_delete_cycle` to the MCP tool registry so agents can permanently remove noise cycles (seeded placeholders Cycles 7–11, aborted cycles, test cycles) without direct DB access. The operation must refuse active cycles, detach issues transactionally, hard-delete the `Cycle` row (cascading `CycleScopeEvent`), and write a durable audit record to a new `AdminAuditLog` Prisma table.

---

## Triggering Symptoms

- Seeded placeholder cycles (KAN Cycles 7–11, velocities 27/26/28/30/34, 0 real issues) pollute `kanon_list_cycles` and skew velocity averages shown in the web Velocity History chart.
- Closed test cycles (e.g. 2026-04-29 cycle) cannot be removed without direct DB access.
- No delete primitive exists in the MCP, API, or CLI today.

---

## Existing Cycle Handlers — Map

| Tool / Route | File | Lines | Pattern |
|---|---|---|---|
| `kanon_list_cycles` | `packages/mcp/src/tools/cycles.ts` | 112–129 | Calls `client.listCycles(projectKey)` → formats; no mutations |
| `kanon_get_cycle` | `packages/mcp/src/tools/cycles.ts` | 131–143 | `client.getCycle(cycleId, opts)` → `formatCycleDetail` |
| `kanon_create_cycle` | `packages/mcp/src/tools/cycles.ts` | 145–175 | Builds body, calls `client.createCycle`; format tier (ack default) |
| `kanon_attach_issues_to_cycle` | `packages/mcp/src/tools/cycles.ts` | 177–208 | `client.attachIssuesToCycle`; format tier (ack default) |
| `kanon_close_cycle` | `packages/mcp/src/tools/cycles.ts` | 210–239 | Orchestrates `closeCycleWithDisposition` (disposition logic inline); format tier |
| `GET /projects/:key/cycles` | `packages/api/src/modules/cycle/routes.ts` | 48–55 | `requireProjectMember("key")` preHandler; calls `cycleService.listCycles` |
| `POST /projects/:key/cycles` | `packages/api/src/modules/cycle/routes.ts` | 57–78 | `requireProjectRole("key","member")`; passes `request.member!.id` as `authorId` |
| `GET /cycles/:id` | `packages/api/src/modules/cycle/routes.ts` | 80–90 | `requireCycleMember("id")` |
| `POST /cycles/:id/close` | `packages/api/src/modules/cycle/routes.ts` | 91–102 | `requireCycleRole("id","member")` |
| `POST /cycles/:id/issues` | `packages/api/src/modules/cycle/routes.ts` | 104–117 | `requireCycleRole("id","member")`; passes `authorId: request.member!.id` |

**Patterns observed across handlers:**
- All cycle mutations use `requireCycleRole` / `requireProjectRole` preHandlers that set `request.member` (`MemberContext: { id, role, workspaceId, userId }`).
- `authorId` is always sourced from `request.member!.id` (Member.id, not User.id).
- Service layer uses `prisma.$transaction` for multi-step mutations (create + attach).
- SSE is emitted **post-commit** via `eventBus.emit()` in a `try/catch` (fire-and-forget); failures never break the mutation.
- Error shape: `AppError(statusCode, code, message)` — code is SCREAMING_SNAKE.
- Format tier: `ack` (default, minimal), `slim`, `full` — controlled via `WriteFormatField` spread into the Zod shape.

---

## Schema Today

### `Cycle` model (`packages/api/prisma/schema.prisma`, lines 279–300)

| Column | Type | Notes |
|---|---|---|
| `id` | `String @id @default(uuid())` | Primary key |
| `name` | `String` | |
| `goal` | `String?` | |
| `state` | `CycleState` (enum: upcoming/active/done) | No dedicated `isActive` boolean — use `state === "active"` |
| `startDate` | `DateTime` | |
| `endDate` | `DateTime` | |
| `velocity` | `Int?` | Set on close |
| `createdAt` | `DateTime @default(now())` | |
| `updatedAt` | `DateTime @updatedAt` | |
| `projectId` | `String @db.Uuid` | FK → Project (onDelete: Cascade) |

Relations: `issues Issue[]`, `scopeEvents CycleScopeEvent[]`.

**No `isActive` boolean field.** The issue body says `cycle.isActive === true` — this maps to `cycle.state === "active"` in the schema. The delete guard must check `cycle.state === "active"`.

### `CycleScopeEvent` model (lines 302–321)

| Column | Type | Notes |
|---|---|---|
| `id` | `String @id` | |
| `day` | `Int` | 1-based day index |
| `kind` | `CycleScopeEventKind` (add/remove) | |
| `issueKey` | `String` | Stored as string — survives issue deletion |
| `reason` | `String?` | |
| `createdAt` | `DateTime @default(now())` | |
| `cycleId` | `String @db.Uuid` | **`onDelete: Cascade`** — rows auto-deleted when Cycle is deleted |
| `authorId` | `String? @db.Uuid` | FK → Member (`onDelete: SetNull`) |

`onDelete: Cascade` on `cycleId` is already in place. When `prisma.cycle.delete` is called, all `CycleScopeEvent` rows for that cycle are automatically removed by the DB. No manual delete needed.

### `Issue.cycleId` relation (line 217–219)

```
cycleId String? @map("cycle_id") @db.Uuid
cycle   Cycle?  @relation(fields: [cycleId], references: [id], onDelete: SetNull)
```

`onDelete: SetNull` — when a Cycle is deleted, all attached issues have `cycleId` set to `null` automatically by the DB. This is the "detach" behavior for free, BUT it bypasses application-level checks (non-terminal state guard, audit of which issues were detached). The service layer must explicitly handle detachment before delete if per-issue logic is needed.

---

## Audit Storage

**Decision: new `AdminAuditLog` Prisma table.** Rationale (pre-decided, not re-debated):
- `CycleScopeEvent` cascades on Cycle delete — any scope-event-based audit is gone post-deletion.
- Engram is rejected — the project needs DB-persisted audit for eventual web UI surfacing.
- A generic `AdminAuditLog(entityType, entityId, action, payload jsonb, authorId, reason, createdAt)` table establishes the pattern for KAN-24 (`kanon_update_cycle`) and future admin tools.

---

## Authorization

The existing `requireCycleRole` preHandler (lines 229–259 of `require-role.ts`) resolves the cycle → project → workspace, then calls `resolveAndCheckMember(user.userId, workspaceId, minimumRole)`. It sets `request.member: MemberContext { id, role, workspaceId, userId }`.

`authorId` for the new delete route = `request.member!.id` (Member.id, same as all other cycle mutations).

For the new `DELETE /cycles/:id` route:
- preHandler: `requireCycleRole("id", "member")` — consistent with close/attach.
- Alternatively, raise the bar to `"admin"` since deletion is irreversible. This is a design decision for the proposal phase.

The MCP `KanonClient` authenticates via API key (`Authorization: Bearer <api_key>` header); the `isAgent: true` Member row is the actor. The same `request.member!.id` flow applies.

---

## SSE Convention

**Existing cycle mutations that emit SSE:**

| Mutation | Event emitted | Where |
|---|---|---|
| `createCycle` (with attachIssueKeys) | `issue.updated` for each attached issue, `fields: ["cycleId"]` | `service.ts` L456–469 |
| `attachIssues` | `issue.updated` for each add/remove key, `fields: ["cycleId"]` | `service.ts` L607–621 |

`closeCycle` does **NOT** emit an SSE event today. The `POST /cycles/:id/close` route only updates the cycle row state.

**`DomainEventType` (event-bus/types.ts):** No `cycle.*` events exist. All cycle cache invalidation in the frontend is driven indirectly via `issue.updated` events (see `use-domain-events.ts` — `handleIssueEvent` invalidates both `issueKeys.all` and `cycleKeys.all`).

**Recommendation for `kanon_delete_cycle`:**
Emit `issue.updated` for each detached issue (`fields: ["cycleId"]`), identical to the pattern in `attachIssues`. This piggy-backs the existing `handleIssueEvent` in `use-domain-events.ts` which already invalidates `cycleKeys.all`, so the deleted cycle disappears from `useCyclesQuery` without any frontend changes. Alternatively, add a dedicated `cycle.deleted` event type (cleaner semantics, but requires frontend handler registration). The simpler path is to reuse `issue.updated`.

---

## Web Impact

**Cycles screen consumption (`packages/web/src/features/cycles/`):**

- `useCyclesQuery(projectKey)` fetches `GET /api/projects/:key/cycles` → `cycleKeys.list(projectKey)`.
- `useCycleQuery(cycleId)` fetches `GET /api/cycles/:id` → `cycleKeys.detail(cycleId)`.
- `CyclesView` auto-selects the active cycle (or first) on load. If the selected cycle is deleted, `useCycleQuery(cycleId)` will return a 404 when the detail is refreshed.
- `VelocityHistory` filters `cycles.filter((c) => c.state === "done")` — deleting done cycles removes their bar from the chart. This is the intended behavior (cleaning noise).

**Cache invalidation after delete:**
If the service emits `issue.updated` events for each detached issue, `use-domain-events.ts` will invalidate `cycleKeys.all`. `useCyclesQuery` refetches and no longer returns the deleted cycle. `useCycleQuery(deletedId)` receives 404 if it was the selected cycle — `CyclesView` falls back to `activeCycle ?? cycles?.[0]` from the refetched list. No 404 crash risk since the list query resolves first.

**Frontend risk flag:** If a user has the deleted cycle selected in the picker at the moment of deletion and the SSE fires before the query settles, `useCycleQuery` will briefly return `undefined` → the component shows "Loading cycle…" momentarily. Not a crash; graceful degradation.

**Out of scope for KAN-23:** No frontend delete button, no delete UI. The tool is MCP-only.

---

## Open Questions

1. **Should `force: true` bypass the guard for `done` issues or only non-terminal (`todo`, `in_progress`, `review`, `backlog`)?**
   - Issue text: "refuse if any are in non-terminal states unless `force: true`". `done` = terminal. So without `force`, done issues detach automatically (safe); the guard only fires when non-terminal issues exist. `force: true` bypasses the guard for non-terminal issues too.
   - **Recommended default:** Non-terminal states = `{ backlog, todo, in_progress, review }`. Done issues always detach silently. `force: true` bypasses the non-terminal guard. This matches the issue intent.

2. **Should `AdminAuditLog.payload` capture the full cycle row snapshot at deletion time, or just metadata?**
   - Full snapshot (name, state, velocity, projectId, startDate, endDate) is cheap and irreversible-delete makes it the only record. Partial metadata saves space but loses recoverability.
   - **Recommended default:** Store full cycle row snapshot + `detachedIssueKeys[]` in `payload jsonb`. Low cost, high recoverability.

3. **Hard delete vs. soft delete via `deletedAt`?**
   - Hard delete: simpler, less schema, `listCycles` needs no filter change. Permanent — no recovery.
   - Soft delete (`deletedAt`): requires filter on all reads, more schema work, defers irreversibility.
   - **Issue says hard delete. Confirmed.** Soft-archive is explicitly listed as out of scope. The `AdminAuditLog` payload snapshot is the recovery path.

4. **Does `kanon_list_cycles` need a change post-delete?**
   - Hard delete removes the row from the DB. `listCycles` query uses `prisma.cycle.findMany({ where: { projectId } })` with no state filter. Once deleted, the row is gone — no filter needed. **No change required.**

5. **Migration strategy for `AdminAuditLog`?**
   - New Prisma migration: `prisma migrate dev --name add-admin-audit-log`.
   - Seeding: none required. Table starts empty.
   - Migration must run before the API server can use the new table. Standard dev workflow: `pnpm --filter @kanon/api prisma:migrate`.

---

## Test Scaffolding Inventory

### MCP tool tests (`packages/mcp/src/tools/cycles.test.ts`)

Existing harness:
- `captureTools(register, client)` → `Map<string, RegisteredTool>` — works by creating a fake McpServer and capturing `server.tool(...)` calls.
- `makeClient()` → mock with `vi.fn()` for `closeCycle`, `getCycle`, `attachIssuesToCycle`, `listCycles`.
- `makeClosed(overrides?)` → `KanonCycle` fixture.
- `makeDetail(issues, overrides?)` → `KanonCycleDetail` fixture.

**New test cases needed (cycles.test.ts):**
- `kanon_delete_cycle — happy path`: mock `client.deleteCycle` returns `{ ok, deletedCycleId, detachedIssueKeys }`.
- `kanon_delete_cycle — active cycle refused`: mock returns 409/error; tool returns `isError: true`.
- `kanon_delete_cycle — force flag`: mock called with `{ force: true }`; verify body forwarded.
- `kanon_delete_cycle — audit record written` (verify `client.deleteCycle` called with `reason`).

### API service tests (`packages/api/src/modules/cycle/service.test.ts`)

Existing harness:
- `vi.mock("../../config/prisma.js", ...)` with full prisma stub (cycle, cycleScopeEvent, issue, project, $transaction).
- `makeTxMock()` returns a tx stub with `cycle.create`, `cycle.updateMany`, `issue.updateMany`, `cycleScopeEvent.createMany`.
- `vi.mock("../../services/event-bus/index.js", ...)` stubs `eventBus.emit`.

**New test cases needed (service.test.ts or new `deleteCycle.test.ts`):**
- `deleteCycle — happy path`: cycle found, state = done, no issues; calls `prisma.adminAuditLog.create` + `prisma.cycle.delete`.
- `deleteCycle — active cycle rejected`: cycle.state = active → throws AppError 409.
- `deleteCycle — non-terminal issues, no force`: cycle has in_progress issue → throws AppError 400.
- `deleteCycle — force = true`: bypasses guard, detaches issues in tx, deletes cycle.
- `deleteCycle — audit record created with payload snapshot`.

**New API route test (`packages/api/src/modules/cycle/routes.test.ts`):**
- Not yet scanned in detail but follows the same Fastify `buildApp()` integration pattern. Add route-level test for `DELETE /cycles/:id`.

---

## Risks

1. **`onDelete: SetNull` on `Issue.cycleId` silently detaches issues at the DB level** — if `prisma.cycle.delete` is called directly without the application-level detach step, no `CycleScopeEvent` records are written and no SSE events fire. The service layer MUST explicitly detach issues (update issues, write scope events) before or inside the same transaction as the delete.

2. **Race condition between detach and delete** — if two concurrent requests hit the delete endpoint for the same cycle, both may pass the guard, and the second will fail the `prisma.cycle.delete` with a "record not found" error. Solution: wrap the entire detach + audit write + delete in a single `prisma.$transaction` with `select for update` semantics (or simply let the second call throw 404 and return gracefully).

3. **Orphaned scope events after delete** — `CycleScopeEvent` has `onDelete: Cascade`, so cascade handles this automatically. Velocity stats (stored as `Int?` on closed cycles) are already materialized on the row at close time; deleting the cycle removes its velocity from the `VelocityHistory` chart. This is intended.

4. **Web cache stale after delete** — if SSE is skipped (no detached issues, force path), `cycleKeys.all` may not be invalidated. Ensure the service emits at least one `issue.updated` event OR add a dedicated `cycle.deleted` event type to trigger `cycleKeys.all` invalidation. Even with 0 detached issues, an event should fire.

5. **`AdminAuditLog` table missing before migration runs** — API will panic at startup if the Prisma client references the new model before `prisma migrate deploy` runs in all environments. The migration must be included in the PR and applied before deployment.

6. **Velocity stats with mock cycles** — seeded mock cycles (Cycles 7–11) have synthetic `velocity` values (27/26/28/30/34). After deletion, the `VelocityHistory` chart average will change. This is the intended cleanup outcome, not a risk per se, but testers should verify the average recalculates correctly after deleting all five.

7. **`requireCycleRole` preHandler does a `findUnique` on the cycle** — if the cycle doesn't exist, it returns 404 before the service is called. The service should still do a `findUnique` for the active-check inside the transaction (defensive), but the 404 from the middleware is the canonical not-found response.

---

## SDD Result Envelope

```yaml
status: complete
executive_summary: >
  Full codebase exploration for kan-23-delete-cycle. All affected paths identified.
  Key discovery: no isActive boolean — guard must check `cycle.state === "active"`.
  CycleScopeEvent cascades automatically; Issue.cycleId is SetNull (DB-level detach
  happens without app code, but app code must run for scope events + SSE).
  No cycle.deleted SSE event type exists — reuse issue.updated pattern or add new type.
  AdminAuditLog table is net-new; migration required. Test harnesses are ready to extend.
artifacts:
  - /home/marxdr/workspace/kanon/openspec/changes/kan-23-delete-cycle/explore.md
next_recommended: sdd-propose
risks:
  - Race condition on concurrent deletes — mitigate with single transaction
  - issue.updated SSE must fire even when 0 issues detached to invalidate cycle cache
  - onDelete:SetNull bypasses app logic if cycle.delete called without explicit detach
  - AdminAuditLog migration must precede deployment
skill_resolution: injected
```

# Proposal: kan-23-delete-cycle

## 1. Intent

Add a permanent-delete primitive for cycles via the MCP so AI agents (and indirectly humans steering them) can purge noise from the cycle history without direct DB access. Today, seeded placeholder cycles (KAN Cycles 7–11 with synthetic velocities 27/26/28/30/34) and aborted/test cycles pollute `kanon_list_cycles` output and bias the web Velocity History chart. Two personas win:

- **Developer/Operator** — clears synthetic and abandoned cycles via `kanon_delete_cycle` instead of opening psql.
- **Project Manager** — sees an honest velocity trend in the Cycles screen because deleted noise no longer skews the average.

The operation hard-deletes the `Cycle` row (cascading `CycleScopeEvent`), explicitly detaches issues with audit, refuses active cycles, and writes a durable `AdminAuditLog` row with a full snapshot for forensic recovery.

## 2. Affected Packages

- `packages/api` — schema migration, service, route, audit module, tests. **Primary surface.**
- `packages/mcp` — new tool registration, `KanonClient.deleteCycle`, tests.
- `packages/bridge` — shared types if any (the `KanonCycleDeleteResult` response shape).
- `packages/web` — **NO UI changes**. We only validate that the existing `handleIssueEvent` SSE handler in `use-domain-events.ts` invalidates `cycleKeys.all` correctly when the new `cycle.deleted` event arrives. One small handler addition in `use-domain-events.ts` is needed (see Decision B). No buttons, no menus, no screens.
- `packages/cli` — **out of scope** (see Decision E).
- `packages/e2e` — out of scope. Coverage lives at unit/service/route level.

## 3. Approach

### 3.1 Schema

New Prisma model, generic by design (sets the pattern for KAN-24 `kanon_update_cycle` and any future admin tool):

```prisma
model AdminAuditLog {
  id         String   @id @default(uuid()) @db.Uuid
  entityType String   @map("entity_type")           // "cycle", later "project", "issue"
  entityId   String   @map("entity_id")             // string, not Uuid — the entity may be deleted
  action     String                                  // "delete", later "update", "force_close"
  payload    Json     @db.JsonB                      // full snapshot + side-effect summary
  authorId   String?  @map("author_id") @db.Uuid    // Member.id; nullable for system actions
  reason     String?                                 // user-supplied free text
  createdAt  DateTime @default(now()) @map("created_at")

  author     Member?  @relation(fields: [authorId], references: [id], onDelete: SetNull)

  @@index([entityType, entityId])
  @@index([authorId])
  @@index([createdAt])
  @@map("admin_audit_logs")
}
```

`Member` gets the inverse relation `adminAuditLogs AdminAuditLog[]`. Migration name: `add-admin-audit-log`.

### 3.2 API surface

- **Route:** `DELETE /cycles/:id` (Fastify) in `packages/api/src/modules/cycle/routes.ts`.
- **PreHandler:** `requireCycleRole("id", "member")` — see Decision A for rationale.
- **Body (Zod):**
  ```ts
  z.object({
    force: z.boolean().optional().default(false),
    reason: z.string().min(1).max(500).optional(),
  })
  ```
- **Response (200):**
  ```ts
  {
    deletedCycleId: string,
    detachedIssueKeys: string[],
    auditLogId: string,
  }
  ```
- **Errors:**
  - `404 CYCLE_NOT_FOUND` (from preHandler).
  - `409 CYCLE_ACTIVE` — cannot delete a cycle in `state === "active"` (no override; even `force` does not bypass).
  - `400 CYCLE_HAS_NON_TERMINAL_ISSUES` — when issues exist in `{ backlog, todo, in_progress, review }` and `force !== true`. Error includes `details: { issueKeys: string[] }`.

### 3.3 Service

New file `packages/api/src/modules/cycle/delete-cycle.ts` (or appended to existing `service.ts`):

```ts
deleteCycle(cycleId: string, opts: { force?: boolean; reason?: string }, authorId: string)
```

Logic (single transaction — see Decision C):

1. `tx.cycle.findUnique({ where: { id }, include: { issues: { select: { id, key, state } } } })` — re-fetch inside tx.
2. Guard: `state === "active"` → throw `AppError(409, "CYCLE_ACTIVE", ...)`. Not bypassable by `force`.
3. Guard: filter issues with `state ∈ NON_TERMINAL_STATES` (constant: `["backlog", "todo", "in_progress", "review"]`). If non-empty AND `!opts.force` → throw `AppError(400, "CYCLE_HAS_NON_TERMINAL_ISSUES", ..., { issueKeys })`.
4. Compute `detachedIssueKeys = issues.map(i => i.key)` (all issues, regardless of state, since hard delete strips them all).
5. Build `payload`:
   ```ts
   {
     cycleSnapshot: { id, name, goal, state, startDate, endDate, velocity, projectId, createdAt, updatedAt },
     detachedIssueKeys,
     force: opts.force ?? false,
   }
   ```
6. `tx.adminAuditLog.create({ data: { entityType: "cycle", entityId, action: "delete", payload, authorId, reason: opts.reason ?? null } })` — capture the returned `id` for the response.
7. `tx.issue.updateMany({ where: { cycleId }, data: { cycleId: null } })` — explicit detach. The DB-level `onDelete: SetNull` would do this for free, but doing it explicitly inside the tx lets us emit SSE per issue and keeps a single, predictable code path.
8. `tx.cycle.delete({ where: { id } })`. `CycleScopeEvent` rows cascade automatically.

Returns `{ auditLogId, deletedCycleId, detachedIssueKeys }` from the tx callback.

**Outside the tx (post-commit, fire-and-forget; matches existing convention):**
- For each `issueKey` in `detachedIssueKeys`: `eventBus.emit("issue.updated", { issueKey, fields: ["cycleId"] })`.
- One `eventBus.emit("cycle.deleted", { cycleId, projectId })` — see Decision B.

### 3.4 MCP

New tool in `packages/mcp/src/tools/cycles.ts`: `kanon_delete_cycle`.

- Input shape: `{ cycleId: string, force?: boolean, reason?: string }` plus `WriteFormatField` (ack default).
- Calls `client.deleteCycle(cycleId, { force, reason })`.
- Format tier: `ack` returns `"Deleted cycle <name> (<n> issues detached)"`; `slim` adds the detachedIssueKeys list; `full` includes the auditLogId.

New method `KanonClient.deleteCycle(id, opts)` issues `DELETE /cycles/:id` with JSON body. Authenticated via the existing `Authorization: Bearer <api_key>` header — the API-key Member row (`isAgent: true`) is the actor recorded in `authorId`.

### 3.5 Web (cache invalidation only)

`packages/web/src/hooks/use-domain-events.ts` adds a handler for the new `cycle.deleted` event:

```ts
case "cycle.deleted":
  queryClient.invalidateQueries({ queryKey: cycleKeys.all });
  break;
```

That is the entire web change. `CyclesView` already falls back to `activeCycle ?? cycles?.[0]` when the selected cycle disappears. No 404 crash because `useCyclesQuery` resolves before `useCycleQuery(deletedId)` re-renders.

## 4. Decisions

### A. Authorization level — **Pick: `requireCycleRole("id", "member")`**

**Rationale.** Symmetric with the rest of the cycle mutation surface (`close`, `attach`, `create`). The `member` role is already gated to people who can mutate the project; bumping just deletion to `admin` introduces an asymmetric step that confuses the permissions story without measurable safety gain. The real safety net for accidental deletes is the **`force` flag + non-terminal guard + irreversible audit row + active-state hard refusal**, not the role gate. API-key actors (`isAgent: true`) hit the same `requireCycleRole` path and resolve their `Member.id` identically.

**Rejected alternatives:**
- **`admin`**: Adds a second authorization tier purely for one operation. We don't have a "destructive admin" concept anywhere else, and inventing one for a single tool is premature. If we later add `delete-project`, `delete-workspace`, or bulk operations, we revisit and bump the whole admin family at once.
- **`requireWorkspaceRole("admin")`**: Strongest, but couples cycle deletion to workspace-level identity resolution. Not aligned with the cycle-scoped middleware family.

### B. SSE strategy — **Pick: Hybrid (Option iii). Emit `issue.updated` per detached issue PLUS one new `cycle.deleted` event.**

**Rationale.** Two failure modes must be covered:
1. **Detached issues need their `cycleId` cache flushed** — the existing `handleIssueEvent` already does this on `issue.updated`. Reusing it costs nothing.
2. **The cycle list cache must invalidate even when `detachedIssueKeys.length === 0`** — for example, deleting an empty placeholder cycle. Option (i) alone fires zero events in that case and leaves the web UI showing a stale row until a manual refresh. That's a load-bearing bug.

Adding `cycle.deleted` as a new `DomainEventType` in `event-bus/types.ts` solves the empty-cycle case cleanly and gives us a semantically correct event for future telemetry/audit subscribers. The `issue.updated` events stay because we already have the per-issue invalidation flow well-tested, and downgrading to "emit nothing per issue, just one cycle event" would mean every detached issue's individual cache stays stale until the cycle event lands and triggers a full sweep. Cheaper to be explicit.

**Rejected alternatives:**
- **(i) issue.updated only**: Breaks on empty cycles. Disqualified.
- **(ii) cycle.deleted only**: Forces the frontend to also invalidate `issueKeys.all` from the cycle event handler, expanding the blast radius of one event into two cache families. Hybrid keeps responsibilities clean (issue events invalidate issue + cycle keys, cycle events invalidate cycle keys).

### C. Transaction boundary — **Pick: Single `prisma.$transaction` (Option i)**

**Rationale.** The race window between guard and mutation is real: two concurrent `DELETE /cycles/:id` calls can both pass the active-state and non-terminal guards, and the second `tx.cycle.delete` will throw `P2025` (record not found). With a single transaction, both reads and writes happen against the same snapshot. Postgres `READ COMMITTED` (Prisma's default) plus the `cycle.delete` lock means the second transaction fails at the delete step instead of corrupting state, and Prisma surfaces `P2025` which we map to `404 CYCLE_NOT_FOUND` — clean idempotent semantics.

We do **not** need explicit `SELECT ... FOR UPDATE`. The implicit row lock taken by `tx.cycle.delete` is sufficient; a redundant `findUnique` lock would add latency without changing the outcome (the second tx would still fail at delete).

**Rejected alternatives:**
- **(ii) Two transactions**: Doubles the race window. Disqualified for an irreversible operation. The "simpler reads" benefit doesn't apply here because the read is one `findUnique` either way.

### D. SSE emission ordering — **Reaffirm convention: post-commit, fire-and-forget in try/catch.**

**Rationale.** Existing cycle and issue mutations all emit SSE *after* the transaction commits, wrapped in `try/catch`, so an event-bus failure never breaks the mutation. The `attachIssues` and `createCycle` services in `service.ts` (lines 456–469, 607–621) set the precedent. Deviating here would introduce a special case ("delete events fire pre-commit") that maintainers would have to learn.

**Tradeoff acknowledged.** Post-commit emission means a process crash between commit and emit results in a stale frontend cache for the workspace until the next manual refresh. This is the same risk every other mutation already accepts. The fix would be transactional outbox, which is a separate, larger architectural decision (probably via the `event-bus` package) and not in scope for KAN-23.

### E. CLI exposure — **Out of scope. MCP-only as the issue specifies.**

**Rationale.** The KAN-23 issue body is explicit: "MCP-only tool." Adding `kanon delete-cycle <id>` to the CLI requires:
- New CLI command file in `packages/cli`.
- API key plumbing or interactive prompt.
- Integration test.
- Confirmation UX (the CLI should require `--yes` for destructive ops; we don't have that pattern yet).

That's a meaningful chunk of new surface, and the issue scope was deliberately limited. If a human operator needs to delete a cycle without the MCP, the API endpoint is reachable via `curl` with an API key. CLI is deferred to a future issue. Recommend filing as a roadmap item: "kanon CLI: add destructive-op confirmation pattern + delete commands."

## 5. Out of Scope

- **Soft delete / `deletedAt`**: Recovery path is the `AdminAuditLog.payload` snapshot. Adding a tombstone column changes every read query in the cycle module and is a separate decision.
- **Web UI**: No delete button in the Cycles screen. MCP-only.
- **CLI command**: See Decision E.
- **Bulk delete**: One cycle per call. Deleting Cycles 7–11 means five MCP calls. Cheap.
- **Undo**: Out of scope. Recovery requires a human reading the audit log and re-creating the cycle by hand.
- **`AdminAuditLog` web surfacing**: The table exists, but no admin screen reads it yet. KAN-25-ish work.
- **Cross-workspace audit aggregation**: Each workspace's authors see only their own audit rows when surfacing arrives. Not designed in this change.

## 6. Rollback Plan

The only schema change is the new `admin_audit_logs` table, which is additive and isolated. Rollback steps:

1. Revert the application code (route, service, MCP tool, web handler).
2. Run the down migration — drops the `admin_audit_logs` table.
3. No data is lost from the existing schema. The audit table starts empty and contains only rows written by the new tool.

If the tool has been used in production before rollback, the audit rows are forfeit (acceptable — they describe operations whose effects are already permanent in the rest of the schema). The cascade behavior of `Cycle` and `Issue.cycleId` is unchanged by this proposal, so a rollback does not corrupt cycle state.

Migration is included in the same PR as the application code. Order of deploy: `prisma migrate deploy` runs first (Prisma client expects the model), then API restart.

## 7. Risks

1. **Race on concurrent deletes.** Mitigated by single-transaction approach (Decision C). Second caller gets clean 404.
2. **Empty-cycle delete leaves stale frontend cache** if SSE strategy emits only per-issue events. Mitigated by hybrid SSE (Decision B) — `cycle.deleted` always fires.
3. **`onDelete: SetNull` on `Issue.cycleId`** would silently bypass the application detach if anyone ever calls `prisma.cycle.delete` directly. Mitigated by routing all deletions through `deleteCycle()` service and adding a unit test that verifies issues are explicitly updated (not just relying on cascade).
4. **`AdminAuditLog` migration ordering.** API panics at startup if the Prisma client is regenerated against the new schema before `prisma migrate deploy` runs. Mitigated by including the migration in the PR and standard deploy order (migrate → deploy app).
5. **Velocity chart visibly shifts after cleanup.** When the five seeded mock cycles are deleted, the Velocity History average will jump (likely downward, since real cycles have lower velocities than the synthetic 27–34 range). Stakeholders should be told this is intentional. Not a code risk; a comms note.
6. **Audit author resolution for API-key actors.** The `Authorization: Bearer <api_key>` flow resolves to a `Member` row with `isAgent: true`. Verify the `requireCycleRole` middleware sets `request.member.id` to that Member.id, not the User.id behind the key. Existing cycle mutations already do this correctly; the delete route reuses the same plumbing.
7. **Audit payload size.** A `Cycle` row snapshot is small (~10 fields, all primitive). `detachedIssueKeys` is a string array — even a 200-issue cycle is well under 10 KB. JSONB column has no practical concern. Skip.

## 8. Affected Acceptance Criteria from KAN-23

> AC1: `kanon_delete_cycle` exists in the MCP tool registry and accepts `{ cycleId, force?, reason? }`.

Satisfied by Section 3.4 — new tool registered in `cycles.ts` with the documented Zod schema.

> AC2: Active cycles cannot be deleted (refused with 409 / clear error).

Satisfied by Section 3.3 step 2 — `state === "active"` throws `AppError(409, "CYCLE_ACTIVE", ...)`. **`force` does not bypass** this guard; the only way to delete an active cycle is to first transition it to `done` or `upcoming`, which is a deliberate UX choice.

> AC3: Issues in non-terminal states block deletion unless `force: true`.

Satisfied by Section 3.3 step 3 — issues filtered by `state ∈ { backlog, todo, in_progress, review }`, error `CYCLE_HAS_NON_TERMINAL_ISSUES` with `details.issueKeys`. `force: true` bypasses. `done` issues always detach silently.

> AC4: Hard-deletes the cycle row and detaches issues.

Satisfied by Section 3.3 steps 7 and 8. Issues detached explicitly inside the tx (not relying on cascade) so SSE events fire and behavior matches the audit record. `CycleScopeEvent` cascades automatically.

> AC5: Writes a durable audit record with full snapshot.

Satisfied by Section 3.1 (new `AdminAuditLog` model) and Section 3.3 step 6. Payload includes the full Cycle row snapshot plus `detachedIssueKeys` and `force` flag. The `auditLogId` returned in the response gives the caller a handle for follow-up.

---

## SDD Result Envelope

```yaml
status: complete
executive_summary: >
  Proposes kanon_delete_cycle as an MCP-only hard-delete with a new generic
  AdminAuditLog table, requireCycleRole("member") authorization, hybrid SSE
  (issue.updated per detached issue + new cycle.deleted event), and a single
  transaction wrapping guard + audit + detach + delete. CLI and web UI are
  out of scope; web changes are limited to one new SSE handler case.
artifacts:
  - /home/marxdr/workspace/kanon/openspec/changes/kan-23-delete-cycle/proposal.md
next_recommended: sdd-spec  # sdd-design can run in parallel — both depend only on the proposal
risks:
  - Empty-cycle delete must still invalidate the web cycles cache (mitigated by new cycle.deleted event)
  - AdminAuditLog migration must precede API deploy or Prisma client panics at startup
  - Concurrent delete race could leave one caller with 404; acceptable as idempotent semantics
skill_resolution: injected
```

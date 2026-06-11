# Spec: kan-23-delete-cycle

## Overview

This change introduces `DELETE /cycles/:id` on the API and `kanon_delete_cycle` on the MCP as the first permanent-delete primitive in Kanon. The operation hard-deletes a `Cycle` row (cascading `CycleScopeEvent`), explicitly detaches all attached issues inside a single transaction, writes a durable `AdminAuditLog` row with a full cycle snapshot, and emits hybrid SSE events post-commit. Active cycles (`state === "active"`) are unconditionally refused. Issues in non-terminal states (`backlog`, `todo`, `in_progress`, `review`) block deletion unless `force: true` is passed. Existing cycle operations (`list`, `get`, `create`, `close`, `attach`) are NOT modified. Web UI, CLI, and soft-delete are NOT introduced by this change.

---

## Affected Capabilities

- `cycle/lifecycle` — adds delete operation to existing lifecycle (create → active → close)
- `audit/admin-trail` — NEW capability; establishes `AdminAuditLog` table as a reusable pattern
- `event-bus/domain-events` — adds `cycle.deleted` event type
- `mcp/cycle-tools` — adds `kanon_delete_cycle` tool alongside existing cycle tools
- `web/cache-invalidation` — extends `use-domain-events.ts` to handle `cycle.deleted`

---

## Requirements

### REQ-CYCLE-DELETE-001: MCP tool surface

The MCP server SHALL expose a `kanon_delete_cycle` tool accepting `{ cycleId, force?, reason? }`.

#### Scenario: Tool registered with correct schema
- **Given** the MCP server is initialized with cycle tools registered via `registerCycleTools(server, deps)`
- **When** the tool registry is inspected
- **Then** `kanon_delete_cycle` MUST be present with input schema:
  - `cycleId`: string, UUID format, required
  - `force`: boolean, optional, default `false`
  - `reason`: string, optional, max 500 characters
  - `format`: `WriteFormatField` (`ack` | `slim` | `full`), optional, default `ack`

#### Scenario: Tool delegates to KanonClient.deleteCycle
- **Given** `kanon_delete_cycle` is called with `{ cycleId: "a1b2c3d4-0001-0001-0001-000000000001", reason: "cleanup placeholder" }`
- **When** the tool executes
- **Then** `client.deleteCycle("a1b2c3d4-0001-0001-0001-000000000001", { force: false, reason: "cleanup placeholder" })` MUST be called exactly once

#### Scenario: Format tier ack (default)
- **Given** `client.deleteCycle` returns `{ deletedCycleId: "a1b2c3d4-0001-0001-0001-000000000001", detachedIssueKeys: ["KAN-12", "KAN-13"], auditLogId: "audit-0001" }`
- **When** the tool is called with default format (`ack`)
- **Then** the response content MUST contain the cycle name and the count of detached issues (e.g. `"Deleted cycle … (2 issues detached)"`) and MUST NOT include `auditLogId`

#### Scenario: Format tier full includes auditLogId
- **Given** the same successful response
- **When** the tool is called with `format: "full"`
- **Then** the response content MUST include `auditLogId: "audit-0001"`

---

### REQ-CYCLE-DELETE-002: Active-state guard

The API SHALL refuse to delete a cycle whose `state === "active"` regardless of the `force` flag.

#### Scenario: Active cycle — rejected unconditionally
- **Given** a cycle with `id = "a1b2c3d4-0000-0000-0000-000000000002"` and `state = "active"`
- **When** `DELETE /cycles/a1b2c3d4-0000-0000-0000-000000000002` is called with `{ force: true }`
- **Then** the response MUST be `409 CYCLE_ACTIVE` with body `{ error: { code: "CYCLE_ACTIVE", message: "..." } }`
- **And** no `AdminAuditLog` row MUST be created
- **And** no SSE event MUST be emitted

#### Scenario: Non-active cycle — not blocked by this guard
- **Given** a cycle with `state = "done"` and no attached issues
- **When** `DELETE /cycles/:id` is called
- **Then** the active-state guard MUST NOT fire and the delete MUST proceed to subsequent guards

---

### REQ-CYCLE-DELETE-003: Non-terminal issue guard with force bypass

The API SHALL refuse deletion when the cycle has issues in `{ backlog, todo, in_progress, review }` unless `force: true` is supplied.

Non-terminal states constant: `["backlog", "todo", "in_progress", "review"]`.

#### Scenario: Non-terminal issues present, force omitted — rejected
- **Given** a cycle with `state = "done"` containing issues `["KAN-7" (in_progress), "KAN-8" (review)]`
- **When** `DELETE /cycles/:id` is called with `{}` (force defaults to false)
- **Then** the response MUST be `400 CYCLE_HAS_NON_TERMINAL_ISSUES`
- **And** `details.issueKeys` MUST equal `["KAN-7", "KAN-8"]`

#### Scenario: Non-terminal issues present, force true — allowed
- **Given** same cycle with issues `["KAN-7" (in_progress), "KAN-8" (done)]`
- **When** `DELETE /cycles/:id` is called with `{ force: true }`
- **Then** the guard MUST NOT fire and deletion MUST proceed

#### Scenario: Only terminal issues — no guard, no force needed
- **Given** a cycle with `state = "done"` containing only issues in `done` state
- **When** `DELETE /cycles/:id` is called with `{ force: false }`
- **Then** deletion MUST proceed without error

---

### REQ-CYCLE-DELETE-004: Explicit issue detachment in transaction

Inside the single `prisma.$transaction`, all attached issues MUST be explicitly detached via `issue.updateMany` before the cycle row is deleted.

#### Scenario: Issues detached before cycle delete
- **Given** a cycle with `state = "done"` and issues `["KAN-3" (done), "KAN-5" (done)]`
- **When** `deleteCycle` executes
- **Then** `tx.issue.updateMany({ where: { cycleId }, data: { cycleId: null } })` MUST be called before `tx.cycle.delete`
- **And** the response `detachedIssueKeys` MUST equal `["KAN-3", "KAN-5"]`

#### Scenario: Cycle with no issues — detach step is a no-op
- **Given** a cycle with `state = "upcoming"` and zero attached issues
- **When** `deleteCycle` executes
- **Then** `tx.issue.updateMany` MUST still be called (zero rows updated) and MUST NOT throw
- **And** `detachedIssueKeys` MUST be `[]`

---

### REQ-CYCLE-DELETE-005: Hard delete with cascade

The cycle row and all `CycleScopeEvent` rows MUST be permanently removed.

#### Scenario: Cycle row deleted
- **Given** a cycle that passes all guards
- **When** `deleteCycle` completes
- **Then** `tx.cycle.delete({ where: { id } })` MUST be called within the transaction
- **And** a subsequent `GET /cycles/:id` MUST return `404 CYCLE_NOT_FOUND`

#### Scenario: CycleScopeEvent rows cascade
- **Given** the same cycle has 3 `CycleScopeEvent` rows
- **When** the cycle is deleted
- **Then** the `CycleScopeEvent` rows MUST be removed via DB cascade (no explicit delete needed in service code)

---

### REQ-AUDIT-LOG-001: AdminAuditLog row written per delete

Every successful delete MUST write exactly one `AdminAuditLog` row inside the same transaction.

#### Scenario: Audit row created on success
- **Given** a cycle `id = "a1b2c3d4-0000-0000-0000-000000000010"` with `state = "done"` and `reason = "remove placeholder"`
- **When** `deleteCycle` succeeds
- **Then** `tx.adminAuditLog.create` MUST be called with:
  - `entityType: "cycle"`
  - `entityId: "a1b2c3d4-0000-0000-0000-000000000010"`
  - `action: "delete"`
  - `authorId: <Member.id from request.member>`
  - `reason: "remove placeholder"`
- **And** the returned `id` MUST be included in the response as `auditLogId`

#### Scenario: Audit row NOT created when guard rejects
- **Given** a cycle with `state = "active"`
- **When** `deleteCycle` is called
- **Then** `adminAuditLog.create` MUST NOT be called

---

### REQ-AUDIT-LOG-002: Payload contains full cycle snapshot and detached issue keys

#### Scenario: Payload shape
- **Given** a cycle with `{ id, name: "Sprint 1", goal: "ship feature", state: "done", startDate, endDate, velocity: 23, projectId, createdAt, updatedAt }` and detached issue keys `["KAN-4", "KAN-5"]`
- **When** the audit row is written
- **Then** `payload` MUST be a JSON object containing:
  - `cycleSnapshot`: all listed cycle fields
  - `detachedIssueKeys: ["KAN-4", "KAN-5"]`
  - `force: false` (or `true` if force was passed)
- **And** `payload` MUST NOT contain cycleSnapshot of a different cycle

---

### REQ-SSE-CYCLE-DELETED-001: New cycle.deleted event type emitted

After the transaction commits, the service MUST emit one `cycle.deleted` event via `eventBus.emit`, fire-and-forget.

#### Scenario: cycle.deleted emitted post-commit
- **Given** a successful delete of cycle `id = "a1b2c3d4-0000-0000-0000-000000000010"` in `projectId = "proj-0001"`
- **When** the transaction commits
- **Then** `eventBus.emit("cycle.deleted", { cycleId: "a1b2c3d4-0000-0000-0000-000000000010", projectId: "proj-0001" })` MUST be called exactly once
- **And** if `eventBus.emit` throws, the HTTP response MUST still be `200` (fire-and-forget)

#### Scenario: cycle.deleted emitted even for empty cycles
- **Given** a cycle with zero attached issues
- **When** the cycle is deleted
- **Then** `eventBus.emit("cycle.deleted", ...)` MUST still be called (not skipped because detachedIssueKeys is empty)

---

### REQ-SSE-ISSUE-UPDATED-001: issue.updated emitted per detached issue

After commit, one `issue.updated` event MUST be emitted for each detached issue.

#### Scenario: One event per detached issue
- **Given** a cycle with detached issues `["KAN-12", "KAN-13"]`
- **When** the transaction commits
- **Then** `eventBus.emit("issue.updated", { issueKey: "KAN-12", fields: ["cycleId"] })` MUST be called
- **And** `eventBus.emit("issue.updated", { issueKey: "KAN-13", fields: ["cycleId"] })` MUST be called
- **And** no other `issue.updated` events for unrelated issue keys MUST be emitted

#### Scenario: Zero detached issues — no issue.updated emitted
- **Given** a cycle with no attached issues
- **When** the cycle is deleted
- **Then** `eventBus.emit("issue.updated", ...)` MUST NOT be called

---

### REQ-AUTH-001: Member-level role gate on DELETE /cycles/:id

The route MUST use `requireCycleRole("id", "member")` as a preHandler.

#### Scenario: Non-member rejected
- **Given** a request with a valid API key for a user with `role = "viewer"` on the project
- **When** `DELETE /cycles/:id` is called
- **Then** the response MUST be `403` before the service is invoked

#### Scenario: Member allowed
- **Given** a request with a valid API key for a user with `role = "member"` on the project
- **When** `DELETE /cycles/:id` is called with a valid `done` cycle
- **Then** `request.member.id` MUST be set and passed as `authorId` to `deleteCycle`

#### Scenario: Cycle not found — preHandler returns 404
- **Given** a `cycleId` that does not exist in the DB
- **When** `DELETE /cycles/:id` is called
- **Then** the response MUST be `404 CYCLE_NOT_FOUND` from the `requireCycleRole` preHandler (before the service is reached)

---

### REQ-WEB-CACHE-001: cycle.deleted invalidates cycleKeys.all in use-domain-events

The web SSE handler MUST react to `cycle.deleted` and invalidate `cycleKeys.all`.

#### Scenario: cycle.deleted event invalidates cycle query cache
- **Given** `use-domain-events.ts` is mounted and `queryClient` has cached `cycleKeys.all`
- **When** a `cycle.deleted` SSE event arrives
- **Then** `queryClient.invalidateQueries({ queryKey: cycleKeys.all })` MUST be called
- **And** the deleted cycle MUST no longer appear in the next `useCyclesQuery` response

#### Scenario: No crash when deleted cycle was selected
- **Given** the deleted cycle was the currently selected cycle in `CyclesView`
- **When** `useCyclesQuery` refetches and no longer includes that cycle
- **Then** `CyclesView` MUST fall back to `activeCycle ?? cycles?.[0]` without throwing

---

### REQ-CONCURRENCY-001: Concurrent delete returns idempotent 404

When two concurrent requests attempt to delete the same cycle, only one MUST succeed; the second MUST receive `404 CYCLE_NOT_FOUND`.

#### Scenario: Second concurrent delete gets 404
- **Given** two simultaneous `DELETE /cycles/a1b2c3d4-0000-0000-0000-000000000010` requests
- **When** both execute concurrently inside their respective transactions
- **Then** exactly one MUST succeed with `200`
- **And** the other MUST receive `404 CYCLE_NOT_FOUND` (Prisma `P2025` mapped to `AppError(404, "CYCLE_NOT_FOUND")`)
- **And** no partial state MUST be left (no orphaned audit row without a matching delete, no double-delete)

---

### REQ-API-RESPONSE-001: Response shape on success

#### Scenario: 200 response body
- **Given** a successful delete of cycle `{ id: "a1b2c3d4-0000-0000-0000-000000000010", name: "Sprint 7" }` with detached issues `["KAN-4", "KAN-5"]` and audit id `"aud-0099"`
- **When** the route returns
- **Then** the response MUST be HTTP `200` with body:
  ```json
  {
    "auditLogId": "aud-0099",
    "deletedCycleId": "a1b2c3d4-0000-0000-0000-000000000010",
    "cycleName": "Sprint 7",
    "detachedIssueKeys": ["KAN-4", "KAN-5"]
  }
  ```
- **Note**: `cycleName` is REQUIRED so the MCP `kanon_delete_cycle` ack tier can render `Deleted cycle "<name>" (<n> issues detached)` without an extra round-trip. Field order matches `DeleteCycleResult` in `packages/api/src/modules/cycle/delete-cycle.ts` (the authoritative shape).

---

### REQ-API-ERROR-001: Error codes and HTTP statuses

The following error map MUST be implemented exactly:

| Code | HTTP | Trigger |
|---|---|---|
| `CYCLE_NOT_FOUND` | 404 | Cycle does not exist (preHandler or P2025 in tx) |
| `CYCLE_ACTIVE` | 409 | `cycle.state === "active"` — not bypassable |
| `CYCLE_HAS_NON_TERMINAL_ISSUES` | 400 | Non-terminal issues exist AND `force !== true` |

#### Scenario: Error response shape
- **Given** a cycle with `state = "active"`
- **When** `DELETE /cycles/:id` is called
- **Then** the response body MUST match `{ error: { code: "CYCLE_ACTIVE", message: "<human-readable string>" } }`
- **And** `CYCLE_HAS_NON_TERMINAL_ISSUES` errors MUST additionally include `details: { issueKeys: string[] }`

---

## Out-of-Scope

This spec does NOT cover:

- **Web UI** — no delete button, menu item, or confirmation dialog in the Cycles screen
- **CLI** — no `kanon delete-cycle` command; MCP-only as specified in KAN-23
- **Soft delete / `deletedAt`** — only hard delete; recovery is via `AdminAuditLog.payload`
- **Undo / restore** — no undo endpoint; manual re-creation from audit snapshot is the recovery path
- **AdminAuditLog web surface** — the table is created but no admin screen reads it (KAN-25+)
- **Bulk delete** — one cycle per call; five calls to clear Cycles 7–11
- **`kanon_list_cycles` changes** — hard delete removes the row; no filter change needed
- **`closeCycle` SSE** — `closeCycle` currently emits no events; this spec does not change that

---

## SDD Result Envelope

```yaml
status: complete
executive_summary: >
  Delta spec written for kan-23-delete-cycle. Fourteen requirements with 28 Given/When/Then
  scenarios cover the MCP tool surface, API guards, transaction semantics, audit log payload,
  hybrid SSE emission, web cache invalidation, concurrency, response shape, and error codes.
  Every scenario maps directly to a test case for sdd-apply.
artifacts:
  - /home/marxdr/workspace/kanon/openspec/changes/kan-23-delete-cycle/spec.md
next_recommended: sdd-tasks  (after sdd-design also completes)
risks:
  - REQ-CONCURRENCY-001 is hard to unit-test without real DB concurrency — integration or
    property test recommended; mock-based service test can only verify P2025 mapping
  - REQ-WEB-CACHE-001 scenario 2 (no-crash fallback) depends on CyclesView component logic
    not changing; fragile if the component is refactored between spec and apply
  - REQ-SSE-CYCLE-DELETED-001 fire-and-forget contract means SSE tests must assert on
    eventBus.emit call order (post-tx), not on the HTTP response timing
skill_resolution: injected
```

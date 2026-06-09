# Design: KAN-40 — Emit notification SSE events for live inbox

## Technical Approach

Wire two new domain events (`notification.created`, `notification.marked_read`) onto the EXISTING workspace SSE bridge. Emit per-site AFTER each successful DB write, fire-and-forget in `try/catch` (D3 isolation). Notification rows do not exist at mutation time, so creates emit from `handlers.ts`/`routeEvent`, not mutation services. Mark-read events emit from the two route handlers. Payloads are BARE (`{}`) — workspace broadcast is privacy-safe only because the web handler reads no payload and the list endpoint is server-scoped `WHERE recipientId=memberId`. One web rename closes the dead listener path. No schema, no migration, no per-user targeting, no read-model.

## Architecture Decisions

| Decision | Choice | Alternatives rejected | Rationale |
|---|---|---|---|
| Emit location | Per-site in `handlers.ts` + routes (Approach A) | Single emit in `routeEvent` after all handlers | Rows created across distinct handlers; single emit can't know if any wrote. Per-site fires only when a row exists. |
| Payload | Bare `{}` (workspaceId/actorId envelope only) | recipientId + content | SSE bridge is workspace-broadcast (no per-user targeting). recipientId/content would leak to every member. Web only invalidates `notificationKeys.list(workspaceId)`; refetch re-scopes server-side. |
| Event names | `notification.created` + `notification.marked_read` | Reuse web's inert `notification.read` | `marked_read` avoids ambiguity with the `read` boolean. Listener was inert → rename is free. |
| Bulk read-all | ONE event after `$transaction` (guard `updatedCount > 0`) | N events in loop | A single invalidation refreshes the whole list. N events = redundant fan-out. |
| Isolation | `try/catch` swallow per site | Let emit reject | A bus error must NEVER make a successful DB write appear to fail (D3). |

## DomainEventType extension (`event-bus/types.ts`)

Append two members to the union (after `issue.batch_transitioned`):

    | "notification.created"
    | "notification.marked_read";

`routeEvent`'s switch has a `default:` no-op and is NOT exhaustive over `DomainEventType` — adding members compiles unchanged. `notification.*` hits `default` → NO re-entrancy loop.

## emit() call shape (bare, fire-and-forget — matches `invite/service.ts:217`)

    try {
      eventBus.emit({ type: "notification.created", workspaceId, actorId, payload: {} });
    } catch {
      // never let emission break the mutation (D3)
    }

`handlers.ts` must add: `import { eventBus } from "../event-bus/index.js";` (not currently imported).

## Per-site plan (6 sites)

| Site | File:line | Emit after | type | workspaceId / actorId | Test file |
|---|---|---|---|---|---|
| handleMentionCreated | handlers.ts:92 | `prisma.notification.create` | created | `event.workspaceId` / `event.actorId` | notification.test.ts |
| handleIssueAssigned | handlers.ts:194 | `prisma.notification.create` | created | `event.workspaceId` / `event.actorId` | notification.test.ts |
| handleSubscribedActivity | handlers.ts:298 | after `createMany` (only when `recipients.length>0` — already an early-return above) | created (once) | `event.workspaceId` / `event.actorId` | notification.test.ts |
| routeEvent batch_transitioned | handlers.ts:534 | inside `if (rows.length>0)` after `createMany` | created (once) | `event.workspaceId` / `event.actorId` | notification.test.ts |
| PATCH `/notifications/:id/read` | routes.ts:310/316 | after the update / transaction | marked_read | `notification.workspaceId` / `notification.recipientId` | __tests__/routes.test.ts |
| POST `read-all` | routes.ts:169 | after `$transaction`, guard `updatedCount>0` | marked_read (once) | `workspaceId` (param) / `memberId` | __tests__/routes.test.ts |

Note: one mutation may emit TWO `notification.created` (assignment + subscribed_activity). Acceptable — web invalidation is idempotent. Do NOT "fix".

## Web rename (`use-domain-events.ts:89`) — ONLY web change

Rename listener `notification.read` → `notification.marked_read`. Keep `notification.created` listener. Handler body (`invalidateQueries(notificationKeys.list(workspaceId))`) UNCHANGED. Name MUST match the API string exactly. Badge derives from the same query key (`inbox-view.tsx:61`) → AC2 met with no other web change. Drop the "API does not yet emit" comment.

## Testing Strategy (strict TDD, red→green)

| Scenario | Approach | File |
|---|---|---|
| DomainEventType accepts new members | type-level / emit with new type compiles | notification.test.ts |
| Each create site emits `notification.created` (bare payload) | `vi.mock("../event-bus/index.js")` factory (copy delete-cycle.test.ts:27); assert `vi.mocked(eventBus.emit)` called with `{type:"notification.created", payload:{}}`; assert NO `recipientId`/`content` key | notification.test.ts |
| Bulk fan-out emits EXACTLY ONE | `toHaveBeenCalledTimes(1)` after `createMany` | notification.test.ts |
| No row → no emit | actor-exclusion / empty-recipients path → `emit` not called | notification.test.ts |
| D3 isolation | `vi.mocked(eventBus.emit).mockImplementation(()=>{throw})`; assert handler resolves + row write happened (shape: delete-cycle.test.ts:479-486) | notification.test.ts |
| Mark-read single + bulk emit `notification.marked_read` (bulk once) | Fastify HTTP test asserting mocked `eventBus.emit` | __tests__/routes.test.ts |

CRITICAL: handler emits use the imported singleton, NOT the injected `registerNotificationService(bus,...)` stub — they are different objects. Must `vi.mock` the singleton module. The mocked emit is inert (no `_handler`), so no re-entrancy in tests.

## Migration / Rollout

No Prisma migration, no schema/data change. Rollback = revert commits.

## Risks / Mitigations

| Risk | Mitigation |
|---|---|
| Payload leaks across workspace | Bare `{}`; test asserts no recipient/content field |
| Missing `eventBus` import in handlers.ts | Explicit edit; known gap today |
| Bulk emits N not 1 | Emit once after createMany/transaction; assert count=1 |
| Web name mismatch | Name must match exactly; api+web land together. Soft-fail: manual refetch still works, only live-update breaks. |

## Open Questions

None.

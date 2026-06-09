# Tasks: KAN-40 — Emit notification SSE events for live inbox

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 250–330 |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | Single PR (api+web MUST land together — name mismatch silently breaks live-update) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | All API + web changes | PR 1 (single) | api+web coupled by event-name contract |

---

## Phase 1: Foundation — DomainEventType extension

_Spec req: "DomainEventType registry extended"_

- [ ] 1.1 **RED** — `packages/api/src/services/event-bus/types.ts`: write a type-level test (compile-only or vitest `expectTypeOf`) asserting that `"notification.created"` and `"notification.marked_read"` are accepted as `DomainEventType` values. Run `vitest run` — expect failure.
- [ ] 1.2 **GREEN** — Append `| "notification.created" | "notification.marked_read"` to the `DomainEventType` union in `packages/api/src/services/event-bus/types.ts`. Run test — expect pass.
- [ ] 1.3 **GREEN check** — Confirm `routeEvent` switch compiles unchanged (non-exhaustive switch; new types hit `default` no-op — no re-entrancy).

> Sequential prerequisite for all Phase 2 tasks.

---

## Phase 2: Handler emit sites — `notification.created`

_Spec reqs: "Emit notification.created on notification creation", "Bare-payload privacy contract", "Emission isolation (D3)"_

All sites: `packages/api/src/services/notification/handlers.ts`

- [ ] 2.1 Add `import { eventBus } from "../event-bus/index.js";` to `handlers.ts` (currently missing).
- [ ] 2.2 **RED** — `packages/api/src/services/notification/notification.test.ts`: write test for `handleMentionCreated` asserting `eventBus.emit` called with `{ type: "notification.created", workspaceId: event.workspaceId, actorId: event.actorId, payload: {} }`. Use `vi.mock("../event-bus/index.js")` (singleton, pattern from `delete-cycle.test.ts:27`).
- [ ] 2.3 **GREEN** — After the `create` call at `handlers.ts:92` (`handleMentionCreated`), add `try { eventBus.emit({ type: "notification.created", workspaceId: event.workspaceId, actorId: event.actorId, payload: {} }); } catch { /* D3 */ }`.
- [ ] 2.4 **RED→GREEN** — Repeat for `handleIssueAssigned` (`handlers.ts:194`): same RED test pattern → same emit call. _Parallel with 2.2–2.3._
- [ ] 2.5 **RED→GREEN** — `handleSubscribedActivity` (`handlers.ts:298`): RED test asserts `toHaveBeenCalledTimes(1)` (batch = ONE event for the createMany). GREEN: emit once after `createMany`, inside `if (recipients.length > 0)` guard.
- [ ] 2.6 **RED→GREEN** — `routeEvent` batch_transitioned (`handlers.ts:534`): RED test asserts emit once inside `if (rows.length > 0)`. GREEN: single emit after `createMany`.

> 2.2–2.6 depend on 1.2. Sites 2.4–2.6 can run in parallel with each other after 2.1.

---

## Phase 3: Privacy + D3 isolation tests

_Spec reqs: "Bare-payload privacy contract", "Emission isolation (D3)"_

- [ ] 3.1 **KEYSTONE RED — privacy** — In `notification.test.ts`: assert emitted payload has NO `recipientId`, `userId`, `memberId`, or content-bearing key. Pattern: `expect(call.payload).not.toHaveProperty("recipientId")` etc. Must cover at least one create site and the mark-read route.
- [ ] 3.2 **GREEN** — Verify all emit calls in Phase 2 + Phase 4 use `payload: {}` (bare). No code change expected if Phase 2 done correctly — test should already pass.
- [ ] 3.3 **KEYSTONE RED — D3 isolation** — `notification.test.ts`: `vi.mocked(eventBus.emit).mockImplementation(() => { throw new Error("bus down"); })` then call handler → assert DB write result resolves without error (pattern: `delete-cycle.test.ts:479-486`). Cover at least `handleMentionCreated`.
- [ ] 3.4 **GREEN** — If 3.3 fails, verify `try/catch` blocks in handlers wrap the emit. No handler should `await` the emit.

> 3.1–3.4 can run in parallel with Phase 4 once Phase 2 is green.

---

## Phase 4: Route emit sites — `notification.marked_read`

_Spec reqs: "Emit notification.marked_read on read state changes", "Bare-payload privacy contract"_

File: `packages/api/src/modules/notification/__tests__/routes.test.ts`
Route file: `packages/api/src/modules/notification/routes.ts`

- [ ] 4.1 **RED** — In `routes.test.ts`, write Fastify HTTP test: `PATCH /notifications/:id/read` → assert `eventBus.emit` called with `{ type: "notification.marked_read", workspaceId: notification.workspaceId, actorId: notification.recipientId, payload: {} }`. Note: no `workspaceId` in route param — use the FETCHED `notification.workspaceId`.
- [ ] 4.2 **GREEN** — After the update/tx in `routes.ts:310–316` (`PATCH /:id/read`), add D3-wrapped emit using fetched `notification.workspaceId` and `notification.recipientId` as actorId.
- [ ] 4.3 **RED** — `routes.test.ts`: `POST /notifications/read-all` → assert `eventBus.emit` called exactly `toHaveBeenCalledTimes(1)` after `$transaction`. Bulk = ONE event.
- [ ] 4.4 **GREEN** — After `$transaction` guard (`updatedCount > 0`) in `routes.ts:169`, add ONE D3-wrapped emit: `{ type: "notification.marked_read", workspaceId, actorId: memberId, payload: {} }`.

> 4.1–4.4 depend on 1.2 and 2.1 (import). Can run in parallel with Phase 3.

---

## Phase 5: Web rename — listener name alignment

_Spec req: "Web listener name alignment"_

- [ ] 5.1 In `packages/web/src/hooks/use-domain-events.ts:89`, rename listener `"notification.read"` → `"notification.marked_read"`. Keep `"notification.created"`. Handler body (`invalidateQueries(notificationKeys.list(workspaceId))`) UNCHANGED.
- [ ] 5.2 Manual verification: confirm badge count in `inbox-view.tsx:61` derives from `notificationKeys.list(workspaceId)` — no additional change required (by design).

> 5.1 can run in parallel with Phase 3–4. MUST land in the same PR as Phase 2–4 (name coupling).

---

## Phase 6: Integration sweep + typecheck

- [ ] 6.1 Run `vitest run` in `packages/api` — full suite must be green.
- [ ] 6.2 Run `tsc --noEmit` in `packages/api` — zero type errors.
- [ ] 6.3 Run `tsc --noEmit` in `packages/web` — zero type errors.
- [ ] 6.4 Spot-check: confirm no emission in any path where row write was skipped (actor-excluded or empty-recipients guard). No-row → no-emit. Add test assertion if missing.

> Sequential — runs after all prior phases.

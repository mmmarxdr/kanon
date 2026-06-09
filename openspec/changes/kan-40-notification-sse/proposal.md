# Proposal: KAN-40 — Emit notification SSE events for live inbox

## Intent

The inbox only updates on manual refetch. The web client already subscribes to
`notification.created` and `notification.marked_read` over the workspace SSE
channel, but the API emits **neither** — so the listeners are inert. Wiring the
emissions makes the inbox list and unread badge update live for any workspace
member (dev/PM) the moment a notification is created or read, with no refresh.

## Motivation

- Listeners are wired (`use-domain-events.ts`) but the API never emits → dead path today.
- core-notify brick; follow-up from KAN-37 slice-1 adversarial review.
- Precedent: ADR-0003 reuses this exact workspace SSE channel for `ppm.readmodel.updated`,
  so the emission pattern set here is load-bearing for later phases.

## Scope

### In Scope
- **Added**: 2 domain events (`notification.created`, `notification.marked_read`) + their emissions.
- Emit `notification.created` at the 4 fan-out sites in `handlers.ts` (after DB write).
- Emit `notification.marked_read` at the 2 mark-read routes (single + bulk, after DB update).
- Rename the web listener `notification.read` → `notification.marked_read`.
- Tests including D3 isolation (emit throw must not fail the mutation).

### Out of Scope
- Per-user SSE targeting (scope creep; privacy is solved by payload hygiene).
- Read-model events (`ppm.readmodel.updated`) — later phase per ADR-0003.
- KAN-32 timeline; any new SSE infrastructure.

## Capabilities

### New Capabilities
- `notification-realtime`: live propagation of notification create/read events over the
  workspace SSE channel, including the bare-payload privacy contract and emission sites.

### Modified Capabilities
- None.

## Approach (settled decisions)

- **Per-site emit (Approach A)** AFTER each DB write, `try/catch` fire-and-forget. Rationale:
  rows don't exist at mutation time, so emission must live in `handlers.ts`/`routeEvent`,
  not the mutation services. D3 isolation — a bus error MUST NEVER fail the mutation.
- **Privacy by payload hygiene**: the SSE bridge is workspace-broadcast (no per-user
  targeting). Payloads MUST be **bare** (only `workspaceId` envelope — no `recipientId`,
  no content). Safe because the web handler only invalidates
  `notificationKeys.list(workspaceId)` and the list endpoint is server-scoped
  `WHERE recipientId=memberId`. Do NOT add per-user targeting.
- **Canonical naming**: `notification.created` + `notification.marked_read` (chosen over the
  web's inert `notification.read` to avoid ambiguity with the `read` boolean). The listener
  was waiting, so the rename is cheap. Badge derives from the same query key, so AC2 needs
  no other web change.
- **Bulk mark-all-read** emits ONE `marked_read` after the transaction, not N.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/api/src/services/event-bus/types.ts` | Modified | +2 `DomainEventType` entries |
| `packages/api/src/services/notification/handlers.ts` | Modified | Add `eventBus` import; emit at 4 sites |
| `packages/api/src/modules/notification/routes.ts` | Modified | Emit at single + bulk mark-read |
| `packages/web/src/hooks/use-domain-events.ts` | Modified | Rename listener to `notification.marked_read` |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Payload leaks across workspace | High impact | Keep payloads bare — no recipientId/content; assert in tests |
| Emit throw fails the mutation (D3) | Med | `try/catch` fire-and-forget at every emit site; isolation test |
| `handlers.ts` missing `eventBus` import | Med | Explicit task; import is a known gap today |
| Bulk emits N events not 1 | Med | Emit once after the transaction; assert count in test |
| Web rename mismatch silently breaks live-update | Med | Listener name MUST match `notification.marked_read` exactly |

## Rollback Plan

No Prisma migration, no schema/data change. Rollback = revert the commits. Web reverts to
the inert listener; API stops emitting. No cleanup required.

## Dependencies

- None. Reuses existing `eventBus` singleton and workspace SSE bridge.

## Success Criteria

- [ ] Inbox list + unread badge live-update on `notification.created` / `marked_read` (AC2), no manual refetch.
- [ ] Emit failures never fail the underlying mutation (D3 isolation, test-proven).
- [ ] Payloads carry only the `workspaceId` envelope — no recipientId or content.
- [ ] Bulk mark-all-read emits exactly one `marked_read` event.

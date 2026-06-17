# Tasks: work-session-resilience (Slice A)

**Change**: work-session-resilience | **Mode**: strict TDD | **Store**: engram
**Scope**: Slice A only. Slice B (cross-MCP identity, recovery, Prisma) deferred to a chained PR.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 250–350 (3 source files modified, 4 test files new/modified, no new source files) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | single PR |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | All four Slice A fixes + tests in one PR | PR 1 | base: main; tests + source in one review |

## Phase 1: MCP UUID Zod Normalization (CreateIssueInput / UpdateIssueInput)

- [x] 1.1 RED — `packages/mcp/src/types.test.ts`: add cases asserting `""` → cleared, valid UUID accepted, non-UUID → ZodError, `null` forwarded, for `CreateIssueInput.{assigneeId,cycleId,parentId}` and `UpdateIssueInput.{assigneeId,cycleId,parentId,roadmapItemId}`. Run, confirm red.
- [x] 1.2 GREEN — `packages/mcp/src/types.ts`: introduce `optionalUuid = z.string().uuid().optional().transform(v => v === "" ? undefined : v)` and apply to the 3 Create + 4 Update UUID fields; for `UpdateIssueInput` use the `.nullable().optional()` variant for `null` clear. Re-run, confirm green.
- [x] 1.3 REFACTOR — extract the schema helper if reused; verify no wire contract change.

## Phase 2: API Cleanup Non-Overlap (app.ts)

- [x] 2.1 RED — new `packages/api/src/modules/work-session/cleanup-concurrency.integration.test.ts`: build app via `buildApp`, mock `cleanupExpired` to resolve slowly, advance fake timers, assert: (a) second tick while in-flight is skipped, (b) `running` flag flips back, (c) `app.close()` clears pending timer (no run after close). Use `vi.useFakeTimers()`. Run, confirm red.
- [x] 2.2 GREEN — `packages/api/src/app.ts` lines 231–244: replace `setInterval` with self-rescheduling `setTimeout` gated by a module-scoped `running` flag; `onReady` schedules the first tick; `onClose` clears the pending timer. Re-run, confirm green.
- [x] 2.3 REFACTOR — keep `.unref()` semantics; verify `onClose` runs the clear in any shutdown path.

## Phase 3: API `work_session.ended` `reason: "stopped"` (service.ts)

- [x] 3.1 RED — `packages/api/src/modules/work-session/service.test.ts`: add assertion in explicit `stopWork` block (line 294–311 region) that the emitted `work_session.ended` payload `reason === "stopped"`. Run, confirm red.
- [x] 3.2 GREEN — `packages/api/src/modules/work-session/service.ts` `stopWork` (line 341–355): add `reason: "stopped"` to the emitted payload. Re-run, confirm green.
- [x] 3.3 REFACTOR — extend the `WorkSessionEndedPayload` type comment in `packages/api/src/services/event-bus/types.ts` to document `"stopped" | "expired"`.

## Phase 4: MCP Heartbeat Jitter + Bounded Retry (heartbeat.ts)

- [x] 4.1 RED — new `packages/mcp/src/heartbeat.test.ts`: stub `KanonClient`; assert (a) jitter delay ∈ `[0.8×, 1.2×]` of base over many samples, (b) transient 5xx → exactly one retry at +1000ms then give-up, (c) HTTP 404 → no retry + clear + log, (d) HTTP 401 → no retry + clear + log. Use `vi.useFakeTimers()`. Run, confirm red.
- [x] 4.2 GREEN — `packages/mcp/src/heartbeat.ts`: replace `setInterval` with `setTimeout` reschedule using `HEARTBEAT_JITTER=0.2`; inspect error `statusCode`; on 401/404 → log + `stopAutoHeartbeat`; on transient 5xx → one retry after 1000ms; on second failure → log + `stopAutoHeartbeat`. Re-run, confirm green.
- [x] 4.3 REFACTOR — keep `unref()` on timers; preserve SIGINT / SIGTERM behavior in `index.ts`.

## Phase 5: Abrupt MCP Shutdown Integration Test

- [x] 5.1 RED — new `packages/api/src/modules/work-session/abrupt-shutdown.integration.test.ts`: Prisma-write a `WorkSession` row with `startedAt = now - 2min`, `lastHeartbeat = now - 6min`; call `cleanupExpired`; assert `WorkLog` row `reason === "expired"`, `durationS ≈ 120`, `via` matches `normalizeVia(source)`; assert `GET /api/issues/:key/worklogs` returns the row. Run, confirm red.
- [x] 5.2 GREEN — no new source; this test becomes green once Phases 2–3 land. Re-run, confirm green.
- [x] 5.3 REFACTOR — document the `lastHeartbeat - startedAt` duration formula in the test header.

## Phase 6: Verification

- [x] 6.1 Run `pnpm --filter @kanon/mcp test` and `pnpm --filter @kanon/api test`; both pass.
- [x] 6.2 Spot-check `kanon_create_issue { assigneeId: "" }` returns success via manual MCP call or an existing integration path.
- [x] 6.3 Confirm `git diff --stat` total ≤ 400 changed lines (Slice A budget).

## Implementation Order

P1 → P2 → P3 → P4 → P5 (test) → P6 (verify). Phases are independent across packages; MCP-only (P1, P4) and API-only (P2, P3) can land in any order. P5 depends on P2 + P3 being green to validate end-to-end. Each phase is strict RED → GREEN → REFACTOR per kanon's `sdd-init/kanon` strict TDD setting.

## Out of Scope (Slice B — chained follow-up)

- `mcpInstanceId` Prisma column + cross-MCP identity
- Boot-time recovery / `kanon_recover_sessions` endpoint and tool
- `~/.cache/kanon/sessions.json` state file
- `WorkSession.endedAt` audit column
- Ghost / recently-expired presence UX in `who_is_working`
- `MIN_WORKLOG_DURATION_S` policy change
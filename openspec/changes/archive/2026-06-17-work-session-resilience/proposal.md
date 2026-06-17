# Proposal: work-session-resilience (Slice A)

## Intent

Work sessions are the core PM primitive (telemetry, time tracking, incident disruption). Four failure modes exist today: (1) MCP `create_issue` / `update_issue` returns 400 on empty-string UUIDs — the bug that blocked a real spike; MCP schemas use `z.string().optional()` for `assigneeId` / `cycleId` / `parentId` / `roadmapItemId` while the API uses `z.string().uuid().optional()`. (2) The cleanup interval can overlap itself on a slow DB — no `running` flag, no `setTimeout` self-rescheduling. (3) Heartbeat fails silently — any 5xx stops the timer and the agent keeps believing the session is alive. (4) The `work_session.ended` payload is asymmetric — `cleanupExpired` emits `reason: "expired"`; explicit `stopWork` emits no `reason`. Forecast cannot distinguish stop from crash.

This change hardens the foundation **without** expanding the product surface.

## Scope

### In Scope (Slice A, ~250–350 changed lines)

- **A1** Tighten `CreateIssueInput` / `UpdateIssueInput` Zod in `packages/mcp/src/types.ts` to `z.string().uuid().nullable().optional()` with a `"" → undefined` transform on the four UUID fields.
- **A2** Replace `setInterval(cleanupExpired, 60_000)` in `packages/api/src/app.ts` with a self-rescheduling `setTimeout` gated by a `running` flag; clear the pending timeout in `onClose`.
- **A3** Add `reason: "stopped"` to the `work_session.ended` event payload in the explicit `stopWork` path of `packages/api/src/modules/work-session/service.ts`.
- **A4** Add ±20% jitter to the MCP heartbeat in `packages/mcp/src/heartbeat.ts` plus a bounded one-retry with 1s backoff on transient failure. Do NOT retry 404 / 401.
- **A5** New integration test in `packages/api/test/.../work-session/` writing a `WorkSession` row via Prisma, aging it past TTL, running `cleanupExpired`, and asserting `reason: "expired"` + `durationS` from `lastHeartbeat` + `via`. Strict TDD red → green.

### Out of Scope (Slice B, explicit chained follow-up)

- `mcpInstanceId` Prisma column + cross-MCP identity.
- Boot-time recovery / `kanon_recover_sessions` endpoint + tool.
- `~/.cache/kanon/sessions.json` state file.
- `WorkSession.endedAt` audit column.
- Ghost / recently-expired presence UX in `who_is_working`.
- 60s `MIN_WORKLOG_DURATION_S` policy.

## Capabilities

### New Capabilities
None.

### Modified Capabilities

- `work-session-lifecycle`: explicit `stopWork` event payload now includes `reason: "stopped"`; cleanup interval is concurrency-safe.
- `mcp-issue-management`: `CreateIssueInput` / `UpdateIssueInput` normalize `""` to `null`/omit for `assigneeId` / `cycleId` / `parentId` / `roadmapItemId`, matching the API's `z.string().uuid().nullable().optional()`.

## Approach

Pure defensive hardening. No Prisma migration, no new endpoint, no new columns. Four source-file edits + one new test, all in `packages/mcp/src/` and `packages/api/src/`. Tests fail first, then are made to pass. Every behavior change is observable in a test assertion (UUID normalization, event payload, cleanup isolation, jitter bounds, retry-on-transient).

## Affected Areas

| Area | Impact |
|------|--------|
| `packages/mcp/src/types.ts` | Modified — 4 UUID Zod fields, both inputs |
| `packages/mcp/src/heartbeat.ts` | Modified — jitter + bounded retry |
| `packages/api/src/app.ts` | Modified — self-rescheduling cleanup |
| `packages/api/src/modules/work-session/service.ts` | Modified — `reason: "stopped"` event |
| `packages/api/test/.../work-session/abrupt-shutdown.integration.test.ts` | New — Prisma-aged → cleanup → WorkLog |
| `packages/mcp/test/.../types.test.ts` (or co-located) | Modified — UUID normalization tests |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| UUID tightening breaks loose-`optional` clients | Low | `"" → undefined` transform preserves wire contract; tests lock it |
| Heartbeat retry masks genuine expiry | Med | One retry, 1s backoff; skip 404 + 401 |
| Cleanup `setTimeout` skip on unclean shutdown | Low | `onClose` clears pending; `running` flag prevents overlap |
| Slice A scope creep toward Slice B (Prisma) | Med | Hard scope line; chained PR enforced |
| Strict TDD misses concurrent MCP processes | Med | Documented in Slice B; abrupt-shutdown test covers one case |

## Rollback Plan

All four source changes are isolated, additive, and behavior-preserving for happy paths. Revert the single commit/PR. No DB changes → no migration rollback. The new integration test is removed in the same revert. UUID schema tightening has a one-line revert (loosen back to `z.string().optional()`); the `"" → undefined` transform becomes a no-op.

## Dependencies

None. No new packages, no Prisma migration, no API additions.

## Success Criteria

- `pnpm --filter @kanon/mcp test` and `pnpm --filter @kanon/api test` pass.
- `kanon_create_issue` with `assigneeId: ""` no longer returns 400.
- `work_session.ended` from explicit `stopWork` carries `reason: "stopped"`; from `cleanupExpired` carries `reason: "expired"`.
- Cleanup interval never overlaps itself under slow-DB simulation.
- Heartbeat jitter ∈ `[0.8×, 1.2×]` of `HEARTBEAT_INTERVAL_MS`; retry only on non-404 non-401 transient.
- New abrupt-shutdown test is red before the fix, green after.
- Total changed lines ≤ 400 (Slice A only). Slice B = separate proposal.
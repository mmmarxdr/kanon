# Design: work-session-resilience (Slice A)

## Technical Approach

Defensive hardening across two packages: tighten MCP UUID Zod validation, refactor the API cleanup scheduler into a self-rescheduling loop, make the `work_session.ended` `reason` symmetric, and add jitter + bounded retry to the MCP heartbeat. No Prisma migration, no new endpoint, no API surface change. Strict TDD: each fix has a red-green test. Slice B (cross-MCP identity, recovery endpoint, state file) is explicitly out of scope and will be a chained PR.

## Architecture Decisions

| Decision | Options | Tradeoff | Picked |
|---|---|---|---|
| UUID optional fields | (a) tighten only Zod + transform; (b) add a boundary normalizer in `kanon-client` | (a) single source of truth, less code; (b) belt-and-suspenders but creates two normalization paths | (a) Zod transform `"" → undefined` for the four UUID fields; wire contract preserved |
| Cleanup scheduler | (a) `setTimeout` self-reschedule + `running` flag; (b) BullMQ / pg-boss | (a) tiny, in-process, matches existing pattern; (b) out of scope, infra-heavy | (a) — replaces `setInterval` in `app.ts`; `onClose` clears the pending timeout |
| Heartbeat retry policy | (a) retry transient 5xx only; (b) retry all errors; (c) no retry | (a) bounded (one retry, 1s backoff), skips 401/404 — matches spec; (b) masks expiry; (c) silent failure | (a) — one retry, give-up-and-log on second failure |
| Heartbeat jitter | (a) fixed ±20% random; (b) decorrelated jitter; (c) no jitter | (a) simple, bounds keep us inside TTL (5min > 2min × 1.2 = 2.4min); (b) more even distribution but more code | (a) — `interval * (0.8 + Math.random() * 0.4)` |
| `reason` field type | string literal union vs free string | API already has `WorkLogReason = "stopped" \| "expired"`; reuse literal | `"stopped" \| "expired"` (matches `WorkLog.reason` and the existing emit on cleanup) |

## Data Flow

```
MCP create_issue  ──Zod.safeParse──► ""→undefined transform──► API.createIssue
MCP heartbeat     ──setTimeout(jitter, ±20%)──► client.heartbeat() ──► 200 | 404/401→log+clear | 5xx→1retry(1s)→log+clear
API cleanup loop  ──onReady: scheduleTick()──► running=true ──cleanupExpired()──finally: running=false, schedule next──► onClose: clearTimeout
API stopWork      ──eventBus.emit("work_session.ended", {reason: "stopped", ...})──► forecast listener (same shape as cleanup)
```

## File Changes

| File | Action | Description |
|---|---|---|
| `packages/mcp/src/types.ts` | Modify | `CreateIssueInput.{assigneeId,parentId}` → `z.string().uuid().optional()` with `.transform(v => v === "" ? undefined : v)`. `UpdateIssueInput.{assigneeId,parentId,roadmapItemId}` same. `cycleId` is already UUID-validated; add the same `"" → undefined` transform. |
| `packages/mcp/src/types.test.ts` | Modify | Add cases: `""` → undefined, valid UUID accepted, non-UUID string rejected, `null` forwarded as null (`UpdateIssue` only). |
| `packages/mcp/src/heartbeat.ts` | Modify | Add `HEARTBEAT_JITTER=0.2`; reschedule with `interval * (0.8 + Math.random() * 0.4)`. Wrap `client.heartbeat` call to inspect `err.statusCode`: skip retry on 401/404 (log + `stopAutoHeartbeat`); one retry on transient 5xx with `setTimeout` 1000ms; give up after second failure (log `issueKey`, `statusCode`, `message`, clear timer). |
| `packages/mcp/test/.../heartbeat.test.ts` | New | Stub a fake `KanonClient`; assert jitter range over many samples; mock 5xx → 200 → no further retries; mock 5xx → 5xx → `stopAutoHeartbeat` called + `console.error`; mock 401 → no retry; mock 404 → no retry. Use `vi.useFakeTimers()`. |
| `packages/api/src/app.ts` | Modify | Replace `cleanupInterval` + `setInterval` with `let pendingTimer: NodeJS.Timeout \| undefined; let running = false; function schedule() { pendingTimer = setTimeout(runTick, 60_000); pendingTimer.unref?.(); } function runTick() { if (running) { schedule(); return; } running = true; cleanupExpired(app.log).catch(...).finally(() => { running = false; schedule(); }); }`. `onReady`: `schedule()`. `onClose`: `clearTimeout(pendingTimer)`. |
| `packages/api/src/modules/work-session/service.ts` | Modify | `stopWork` (line 342–355): add `reason: "stopped"` to the emitted payload. Keep `workLogId`, `durationS`, `issueKey`, `issueId`, `memberId`, `userId`. |
| `packages/api/test/.../work-session/event-reason.test.ts` | New | Sub-test: explicit stop emits `payload.reason === "stopped"`; cleanup path (existing coverage at line 645) emits `payload.reason === "expired"`. |
| `packages/api/test/.../work-session/cleanup-concurrency.test.ts` | New | Inject a slow `cleanupExpired` mock (or build app via `buildApp`, override import). Assert: while in-flight, next tick skipped; `running` flips back; `app.close()` clears pending timer (timer count after close = 0). Use `vi.useFakeTimers()`. |
| `packages/api/test/.../work-session/abrupt-shutdown.integration.test.ts` | New | Prisma writes a `WorkSession` row with `startedAt = now - 2min`, `lastHeartbeat = now - 6min` (past TTL); call `cleanupExpired`; assert `WorkLog` row has `reason="expired"`, `durationS ≈ 120`, `via = normalizeVia(s.source)`; then `GET /api/issues/:key/worklogs` shows it. |

## Interfaces / Contracts

```ts
// packages/mcp/src/types.ts — UPDATED
const optionalUuid = z.string().uuid().optional()
  .transform(v => (v === "" ? undefined : v));

// CreateIssueInput.cycleId, assigneeId, parentId use optionalUuid
// UpdateIssueInput.{assigneeId, cycleId, parentId, roadmapItemId} use optionalUuid
//   (note: UpdateIssueInput also accepts explicit null per API; .nullable().optional() + same transform)

// packages/api/src/services/event-bus/types.ts — UNCHANGED type, but payload now carries reason
type WorkSessionEndedPayload = {
  issueKey: string;
  issueId: string;
  memberId: string;
  userId: string;
  workLogId: string | null;
  durationS: number;
  reason: "stopped" | "expired";   // NEW — symmetric
};
```

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit (MCP Zod) | UUID normalization `""` → undefined, valid UUID ok, garbage rejected | `types.test.ts` additions, no DB |
| Unit (MCP heartbeat) | Jitter bounds, retry on transient, no-retry on 401/404, give-up clears timer | `heartbeat.test.ts` with `vi.useFakeTimers()` + stub client |
| Unit (API service) | `work_session.ended` payload `reason: "stopped"` from explicit stop | extend `service.test.ts` line 294–311 region |
| Integration (API) | Abrupt MCP shutdown → `cleanupExpired` → WorkLog row observable via `/worklogs` | New integration test using real Prisma against test DB |
| Integration (app.ts) | Cleanup non-overlap; `onClose` clears pending timer | New test with `vi.useFakeTimers()` + `buildApp()` |

Strict TDD order: write the failing test → run → confirm red → implement → re-run → confirm green. Forbidden: implement before red.

## Migration / Rollout

No DB migration. No feature flag. Deploy order: (1) MCP package ships first (UUID + heartbeat); MCP and API stay wire-compatible because `"" → undefined` matches the API's existing tolerance. (2) API package ships second (cleanup + reason). One PR per package OR a single chained PR — single reviewable PR (~250–350 lines including tests) is recommended.

Rollback: revert the single commit/PR. UUID schema tightening has a one-line revert (loosen back to `z.string().optional()`); the `"" → undefined` transform becomes a no-op. Self-rescheduling timer revert restores `setInterval`. `reason` field removal on explicit stop is a one-line revert; the cleanup path is unchanged.

## Open Questions

- None blocking. The forecast listener already subscribes to `work_session.ended` and only inspects `workLogId`; adding `reason` is additive.
- Confirmation: do NOT expand `cycleId` / `parentId` filter semantics in `ListIssuesInput` — out of scope.
# work-session-lifecycle Specification

## Purpose

Define the lifecycle of a `WorkSession` in the Kanon API: how sessions start, heartbeat, end explicitly, and end via TTL cleanup. This capability is the foundation for time tracking, presence (`who_is_working`), and forecast disruption signals. The behavior covered here was hardened in the `work-session-resilience` change (Slice A) without expanding the product surface.

The requirements below codify:

- Non-overlapping execution of the expired-session cleanup loop, even when a single run is slower than the interval.
- A self-rescheduling cleanup timer whose pending tick is cleared on shutdown.
- A distinguishable `reason` field on the `work_session.ended` event payload (`"stopped"` vs `"expired"`).
- Correct production of an `expired` `WorkLog` row — including `durationS` derivation from `lastHeartbeat - startedAt` — when an MCP process dies abruptly.

## Requirements

### Requirement: Work Session Cleanup Runs Non-Overlapping

The API server MUST execute the expired-session cleanup loop in a way that prevents two concurrent runs from overlapping, even when a single run is slower than the interval.

The cleanup scheduler MUST be self-rescheduling. A `running` flag (in-process, module-scoped) MUST be set to `true` when a run starts and MUST be set to `false` in a `finally` block. If a scheduled tick fires while `running` is `true`, the tick MUST be skipped and the next tick MUST be scheduled normally. On `onClose`, any pending scheduled tick MUST be cleared.

#### Scenario: Slow cleanup prevents overlap

- GIVEN the cleanup loop is in progress and has not yet completed
- WHEN the next scheduled tick would fire
- THEN no second concurrent run is started
- AND a fresh tick is scheduled after the in-flight run completes

#### Scenario: Server shutdown clears pending tick

- GIVEN a cleanup tick is scheduled but has not fired
- WHEN the API `onClose` hook runs
- THEN the pending tick is cleared
- AND no cleanup runs after shutdown begins

### Requirement: Explicit `stopWork` Emits `reason: "stopped"`

When a `WorkSession` is ended by an explicit user-driven `stopWork` call (as opposed to expiry cleanup), the `work_session.ended` event payload MUST include a `reason` field with the value `"stopped"`.

When a `WorkSession` is ended by `cleanupExpired`, the `work_session.ended` event payload MUST include a `reason` field with the value `"expired"`.

The two event variants MUST be distinguishable by downstream listeners (e.g. forecast) on the `reason` field alone, without inspecting the originating code path.

#### Scenario: Explicit stop carries `reason: "stopped"`

- GIVEN an active `WorkSession` for the current user on `issueKey`
- WHEN the user calls `POST /api/me/work-sessions/stop` (or the MCP equivalent)
- THEN a `work_session.ended` event is emitted
- AND the event payload `reason` equals `"stopped"`

#### Scenario: Expired cleanup carries `reason: "expired"`

- GIVEN a `WorkSession` whose `lastHeartbeat` is older than `SESSION_TTL_MS`
- WHEN `cleanupExpired` processes the session
- THEN a `work_session.ended` event is emitted
- AND the event payload `reason` equals `"expired"`

### Requirement: Abrupt MCP Shutdown Produces an `expired` WorkLog

If an MCP process dies after `startWork` succeeds (process crash, `kill -9`, OOM, machine sleep) and a `WorkSession` row persists in the database past `SESSION_TTL_MS`, the next `cleanupExpired` run MUST:

- Treat that session as expired
- Produce a `WorkLog` row with `reason: "expired"`
- Compute `durationS` from `lastHeartbeat - startedAt` (not from current `now`)
- Thread `via` to reflect the originating source

The resulting `WorkLog` MUST be observable end-to-end via the worklog-list endpoint.

#### Scenario: Aged session is cleaned up after abrupt shutdown

- GIVEN a `WorkSession` row written directly via Prisma with `lastHeartbeat` older than `SESSION_TTL_MS`
- WHEN `cleanupExpired` runs
- THEN a `WorkLog` is created with `reason: "expired"`
- AND `durationS` equals `floor((lastHeartbeat - startedAt) / 1000)`
- AND `via` is set consistently with the session's `source`

#### Scenario: One session's cleanup failure does not abort the loop

- GIVEN multiple expired sessions in the same tick
- AND one session's cleanup throws an unexpected error
- WHEN `cleanupExpired` runs
- THEN remaining sessions are still processed
- AND the failing session is reported via logs without aborting the loop
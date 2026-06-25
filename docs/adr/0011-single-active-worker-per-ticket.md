# ADR-0011: Single active worker per ticket

- Status: Accepted
- Date: 2026-06-25
- Epic: ppm-foundation (work capture) — team-readiness hardening (KAN-159)
- Issue: KAN-160
- Related: ADR-0010 (work-session lifecycle from transitions — the transition listener now respects this rule), KAN-156 (transition-driven session open), the reconciliation gate (KAN-157), forecast engine (loggedH person-hour sum)

## Context

The forecast engine sums person-hours per issue with no parallelism model. Two devs logging 4h each on an 8h issue → `loggedH = 8` → the engine reports "2 days remain" when the work is actually done. Worse, the close-time reconciliation only approves the closer's own captured time, so a co-worker's hours stay unapproved and are silently dropped from the canonical total. The engine reviewer flagged this cluster (gaps #1/#2/#3) as CRITICAL for multi-member teams.

Two ways out: (a) model concurrency in the engine (per-member allocation, overlap math, multi-approver reconciliation), or (b) remove concurrency from the domain so the existing single-stream math stays correct.

## Decision

**Enforce at most one open (non-expired) WorkSession per issue at any time.** A ticket is worked by one person at a time. The assignee can still change — a hand-off is: the current worker stops (or their session expires via the 5-min TTL), then another member starts. Two members cannot hold concurrent open sessions on the same issue.

Enforcement lives in `startWork` (the single choke point — both explicit `start_work` and the transition listener route through it):

- Before any mutation, look for another member's open session on the issue (`userId ≠ caller`, `lastHeartbeat > now − TTL`).
- **Explicit `start_work`** (human/agent intent) → refuse with `409 ISSUE_BUSY` naming the current worker and the hand-off path.
- **Transition-driven open** (the listener, e.g. a PM dragging a card) → **no-op**: do not open a second session, do not throw (a transition must never crash on contention). Controlled by `opts.onConflict: "throw" | "skip"`.
- The prior soft "other active workers" **warning** path is removed — replaced by this hard rule.

The caller's *own* existing session on the issue is not a conflict (the upsert just refreshes it).

## Consequences

- The engine's `loggedH` is always a single member's stream → the existing math is correct; engine gaps #1/#2/#3 dissolve with no engine change.
- Reconciliation at close only ever deals with one member's time (no orphaned co-worker hours).
- Hand-off is explicit and observable (stop → start), not silent concurrency.
- A human who tries to start a busy ticket gets a clear error, not a confusing partial capture.
- The transition listener silently declines to open a second session when someone else is working — the transition itself still succeeds.
- The rule applies to **incidents too**: if one engineer already has an open session on an incident, a second cannot also open one — they must hand off (the first stops/expires). Two responders can still collaborate; only the *time capture* is single-stream, which is the point (the engine can't attribute parallel hours). Revisit only if concurrent incident capture is genuinely needed.

## Known limitation (accepted)

The guard is **check-then-act**, not atomic. "Open" is defined by `lastHeartbeat > now − TTL` (time-based), which cannot be expressed as a DB unique constraint, so two `start_work` calls racing within milliseconds could both pass the check and open sessions for two users. This is rare (two humans starting the identical ticket simultaneously) and self-heals at the next reconciliation/expiry. True atomicity would need a different schema (e.g. a single `Issue.currentWorker` FK) — deferred until contention is observed in practice. Marked with a `ponytail:` comment at the guard.

## Alternatives considered

| Option | Rejected because |
|--------|------------------|
| Model parallelism in the engine | Large: per-member allocation, overlap accounting, multi-approver reconciliation, UI. Solves a problem we can instead remove. |
| Allow concurrency, fix only reconciliation (approve all workers) | Leaves the `loggedH` overcount in the engine; still needs a parallelism model for the forecast. |
| `Issue.currentWorker` FK with a DB constraint | True atomicity, but a schema migration + lifecycle wiring for a race that may never matter. Revisit if contention appears. |
| Keep the soft warning | Does not prevent the overcount; the engine still sums two streams. |

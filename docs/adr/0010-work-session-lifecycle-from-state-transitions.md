# ADR-0010: Work-session lifecycle from issue state transitions

- Status: Accepted
- Date: 2026-06-24
- Amended: 2026-08-11 (KAN-243 bounded activity lease)
- Epic: ppm-foundation (work capture)
- Issue: KAN-156 (+ companion reconciliation ticket, + editor-extension roadmap item)
- Related: ADR-0001 (canonical hours & approval flow — amended here), KAN-143 (start_work→auto-advance, inverse coupling), KAN-144 (activity-gated heartbeat), KAN-33 (synced-from-tools rail)
- Supersedes (in part): ADR-0001's "PM approval is the trust gate" — see Amendment.

## Context
Time is only captured via tracked work sessions, but nothing opens one automatically — it depends on an agent calling `start_work`. So time is silently lost (a ~6h pairing session was lost this way; there is no manual-entry UI and no backfill path). The heartbeat is a blind 2-min timer (MCP-session liveness), not a real activity signal, so idle inside the window is counted and off-hours are unhandled. And Kanon can only observe MCP/agent activity — non-MCP work (hand-coding in the IDE, pasting from a web chatbot) is invisible and undercounted (e.g. 8h worked, 4h with the agent + 4h by hand → only 4h captured).

Capture must be **organic and tool-agnostic** (identical in Claude Code / Cursor / OpenCode, no per-client habit), **truthful** (don't invent time you can't observe), yet **complete** (don't lose the manual hours).

## Decision

**Three decoupled layers:**

1. **The issue state defines the WINDOW.** A server-side listener on `issue.transitioned` manages the WorkSession:
   - → `analysis` / `in_progress` (first entry into active work): open a session for the **transitioning member** if none open.
   - → `review` / `done`: close the open session (write the WorkLog).
   - `review → in_progress` (rework): reopen / resume.
   - Idempotent (≤ one open session per member+issue; re-entering an open state and closing-when-none-open are no-ops).
   - **KAN-143 circular guard:** the listener must ignore transitions that `start_work` itself caused, once KAN-143 lands.

2. **Activity leases define what accrues inside the window.** The heartbeat becomes **activity-driven** (emit on a real agent tool call / user prompt, debounced ~once/2 min) instead of a blind timer, and **source-agnostic** (any connected tool may heartbeat — MCP agent now, editor extension / git activity later). Entering `analysis` / `in_progress` is the first activity signal; each signal grants or refreshes a bounded 5-minute lease. `lastHeartbeat` is therefore the lease start, not the captured end marker:
   - `capturedEnd = min(observed stop/review/done, lastHeartbeat + SESSION_TTL_MS)`.
   - Every positive whole-second duration is persisted; only a zero-second interval is unrepresentable by the current schema.
   - Repeated `start_work` adopts and refreshes a fresh session without changing its ID or `startedAt`. After lease expiry, it finalizes the stale window once and opens a distinct window instead of bridging idle time.
   - Bursty work within an active state expires and resumes as **multiple WorkLogs** — interval accounting falls out of existing primitives, with no new accumulation schema.
   - Lifecycle mutations are generation-aware without a schema change: stale finalization and replacement share one serializable transaction, cleanup claims the observed `(session ID, lastHeartbeat)` before writing a WorkLog, and close paths target the observed session ID. Transition effects are serialized per issue so arrival order is preserved while different issues remain independent.

   No activity beyond the lease pauses capture. Observable state exits cap the lease early, so review, done, and explicit stop never accrue beyond a known close.

3. **The dev reconciles + tops up at close.** Because non-observable work exists, leaving active work (→ `review`, and required before `done`) surfaces the captured active time and **forces the dev to confirm or adjust**, with an explicit **"add manual hours"** field for what Kanon could not see. The reconciled total (observed-active + dev-attested-manual) becomes the canonical TimeEntry. Contextual and forced — not free-form anytime — so the observed part stays truthful while unobserved hours aren't lost.

## ADR-0001 amendment
Activity-gating removes the raw overcount that PM approval existed to correct, so the **dev's close-time reconciliation replaces PM approval** as the canonical-hours gate. The TimeEntry is the dev-attested reconciled total; PM `adjust`/`reject` remains an exception path. (Carried out in the reconciliation ticket.)

## Consequences
- Time capture is organic: transition the ticket, work, and the active time is captured in any client — no `start_work` ritual.
- Capture is bounded and reconcilable: only activity leases auto-accrue, and the dev attests unobservable work at close.
- Precision is deliberately bounded rather than silently lossy: a missing final signal can overcount by at most one TTL, while an observed stop/review/done caps capture immediately. This accepts a small bounded overcount instead of deleting the entire initial or sub-minute window.
- No timezone/jornada infrastructure — the activity signal is the off-hours/idle filter.
- The MCP heartbeat change (activity-driven) and the heartbeat→resume coupling are real work; the transition listener is independently shippable first.
- Editor-activity extensions (roadmap) progressively shrink the manual top-up.

## Scope / slicing
- **KAN-156:** transition-driven lifecycle listener + activity-driven, source-agnostic heartbeat.
- **Companion ticket:** reconciliation gate at close (UI + transition guard + this ADR-0001 amendment).
- **Roadmap:** editor-activity extensions (VS Code / Cursor / JetBrains).

## Alternatives considered
| Option | Rejected because |
|--------|------------------|
| Agent must call `start_work` (status quo) | Not organic; silently lossy; per-client habit, not a product behavior. |
| Wall-clock between transitions | Counts nights/idle/blocked time; misleading on multi-day issues. |
| Hybrid trigger (transitions + MCP SSE start/stop) | Adds SSE wiring + races for control the state machine already provides deterministically. |
| Timezone + working-hours config (member/workspace) | Over-complex (migration + UI + DST); the activity signal already excludes off-hours. |
| Keep PM approval as the gate | Redundant once capture is activity-gated; the dev's close-time reconciliation is the better, contextual gate. |
| Auto-approve and drop any human step | Loses the unobservable manual hours (the 4h-by-hand case); the dev must be able to top up. |

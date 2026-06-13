# ADR-0001: Canonical hours source & promotion/approval flow

- Status: Accepted
- Date: 2026-06-08
- Epic: ppm-foundation
- Related: ADR-0002 (rate snapshot), ADR-0003 (materialization)

## Context

Kanon already auto-captures actual time: `WorkLog.durationS` is persisted on every work-session stop/expiry (only if ≥ 60s) in `work-session/service.ts`. Nothing aggregates it — it is a latent asset, not a billing source. WorkLog is machine-captured and may overcount (idle, abandoned sessions capped by `lastHeartbeat`). For PPM we need a **canonical, trustworthy** hours figure that feeds cost, CPI and invoicing. Raw heartbeat time is not invoice-grade.

The Kanon thesis is "don't take the dev out of flow / provenance, not agents." A purely manual timesheet violates flow; a purely automatic one is not trustworthy for billing.

## Decision

A **hybrid, human-gated** model:

1. `WorkLog` stays unchanged — raw, append-only capture. Never billed directly.
2. A **promotion** step turns one or more WorkLogs into a `TimeEntry` in status `draft` (`sourceWorkLogId` records provenance). Issue-less work is allowed (`issueId` nullable).
3. The developer **submits** (`draft → submitted`); a PM **approves** (`submitted → approved`) or **rejects**.
4. **Only `approved` TimeEntry rows feed cost / CPI / billing rollups.** The status enum IS the gate.

`TimeEntryStatus = draft | submitted | approved | rejected`. Approval is the human final word over machine capture.

## Consequences

- Cost and CPI are computed exclusively from `approved` TimeEntry — deterministic and auditable.
- WorkLog overcount never leaks into financials; the approval gate absorbs idle/abandoned noise.
- Provenance is preserved (`sourceWorkLogId`) so a dev can promote from real captured time instead of typing from memory — keeps flow.
- Adds an approval workload for PMs; mitigated by bulk-approve and timesheet (week) submission.
- Rollup invalidation keys off `time-entry.approved` / `.rejected` events (ADR-0003).

## Alternatives considered

| Option | Rejected because |
|--------|------------------|
| WorkLog as the billable source directly | Not invoice-grade; overcounts idle/abandoned; no human accountability. |
| Pure manual timesheet (no capture link) | Breaks flow; data entered from memory is low-fidelity; ignores the asset we already have. |
| Auto-approve promoted entries | Removes the human final word; defeats the trust requirement for billing. |

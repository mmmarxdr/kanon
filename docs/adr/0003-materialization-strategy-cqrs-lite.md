# ADR-0003: Materialization strategy (CQRS-lite read-model)

- Status: Accepted
- Date: 2026-06-08
- Epic: ppm-foundation
- Related: ADR-0001, ADR-0002, ADR-0004

## Context

The PPM workload is asymmetric. **Writes** are frequent and small (WorkLog capture, issue transitions, time-entry approvals). **Reads** are heavy and fan out: a single PM dashboard or C-Level portfolio view computes SPI/CPI/health/scope-creep across **N projects** at once. Computing EV math on every read — joining issues, schedules, approved time entries and budgets per project — does not scale to the portfolio altitude.

Kanon already has an in-process event bus (`services/event-bus/`, `IEventBus.emit/subscribe/subscribeToWorkspace`) and a workspace SSE endpoint (`modules/events/workspace-events.ts`) that streams `event: {type}` frames with `Last-Event-ID` replay. We should reuse this spine, not build a new one.

## Decision

**CQRS-lite: a materialized read-model recomputed on write, served verbatim on read.**

1. **Precompute into a table — `ProjectReadModel`** (1:1 with Project): the four health semaphores, `spi`, `cpi`, `scopeCreep`, `load`, the EV inputs (`plannedValue`, `earnedValue`, `actualCost`, `billedRevenue`), `lastCalc`, and `version`.
2. **Table, not in-memory cache.** A table survives process restart and — critically — is **sortable/filterable for the portfolio query** across N projects in one SQL statement. An in-memory cache cannot serve the C-Level rollup efficiently and loses state on restart.
3. **Invalidation by event.** A single subscriber, `ppm-readmodel/rollup-listener.ts`, listens on `eventBus.subscribe` and recomputes the affected project's row:

   | Write event | Recompute |
   |-------------|-----------|
   | `time-entry.approved` / `.rejected` | actualCost, billedRevenue, cpi, costHealth |
   | `issue.state_changed` / progress update | earnedValue, spi, scheduleHealth |
   | `cycle.scope_changed` | scopeCreep, scopeHealth |
   | `budget.upserted` | costHealth (per-period compare) |
   | `member-rate.updated` | none retroactive (snapshots immutable, ADR-0002) |

4. **Re-emit for the UI.** After upsert, the listener emits a new domain event `ppm.readmodel.updated {projectId}`. The existing SSE endpoint streams it to web/mcp (ties to KAN-40 live inbox). The read path (`GET /projects/:id/health`) reads the row directly — **zero compute on read**.
5. **Staleness + rebuild.** `lastCalc` marks freshness; `version` guards concurrent upserts. A `rebuildProjectReadModel(projectId)` job recomputes from source for backfill, drift repair, or formula changes.

## Consequences

- Portfolio read is one indexed table scan, independent of issue/time-entry volume.
- Health is eventually consistent (recompute is fire-and-forget after the write commits); `lastCalc` makes staleness visible, matching the mock's "4 min ago" UX.
- Read-model is fully derived — it can always be dropped and rebuilt from source, so it carries no migration risk of its own.
- Adds one subscriber and one event type over the **existing** in-process bus; the read-model's `rebuildProjectReadModel` job is the backstop for any dropped event (eventual consistency, `lastCalc` surfaces staleness). The robust event-delivery substrate (durable queue/broker, retry/DLQ, dual-write fix) is intentionally **out of scope here** — deferred to a dedicated cycle to be designed with proper infra + documented docker-compose deploy (tracked as a roadmap item). The broker choice (Redis/BullMQ, NATS, Kafka) is open there, not precluded — and outbox-on-Postgres was considered and set aside as a smell.
- Formula evolution = bump logic + run rebuild job; no read-path change.

## Alternatives considered

| Option | Rejected because |
|--------|------------------|
| Compute on every read | Does not scale to N-project portfolio; repeated heavy joins. |
| In-memory cache (LRU) | Lost on restart; cannot serve sortable portfolio query; cache-stampede risk. |
| DB materialized view | Refresh granularity is per-view not per-project; harder to trigger from app events; Prisma support is thin. |
| Synchronous recompute inside the write txn | Couples write latency to read-model cost; a failing rollup would block captures. |

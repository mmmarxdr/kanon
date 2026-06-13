# Design: PPM Foundation — Data Model & Metrics Spine

One data spine, three altitudes (Delivery / Management / C-Level). Write-heavy capture (WorkLog, transitions, TimeEntry) feeds a read-heavy materialized read-model (health / SPI / CPI / portfolio) invalidated on write — CQRS-lite. All migrations are **additive**: no existing column is dropped or repurposed. Derived metrics live in the read-model, never on source tables.

## Quick path (the spine in one line)

```
capture (WorkLog/transition/TimeEntry) → eventBus.emit(DomainEvent)
   → RollupListener recompute → ProjectReadModel table (upsert + lastCalc)
   → eventBus.emit("ppm.readmodel.updated") → SSE /api/events/workspace/:wid → web/mcp
```

The event bus (`packages/api/src/services/event-bus/`, `IEventBus.emit/subscribe`) and the SSE endpoint (`modules/events/workspace-events.ts`) already exist. PPM attaches one new subscriber (the rollup listener) and one new event type; it does not invent transport.

## Phasing

| Phase | Scope | New tables / services |
|-------|-------|-----------------------|
| **P1** | Foundation schema + rates/budgets CRUD + hours rollup | `MemberRate`, `Budget`, `TimeEntry`, extend `IssueDependency`, `Project.kind`; rollup service |
| **P2** | Health / cost read-model | `ProjectReadModel`; RollupListener + invalidation |
| **P3** | Gantt / milestones | `IssueSchedule`, `Milestone`, `MilestoneDeliverable`; critical-path on-read |
| **P4** | Exec portfolio rollup | portfolio aggregation over `ProjectReadModel` (no new table) |

## Schema deltas (all additive)

### New enums

| Enum | Values | Notes |
|------|--------|-------|
| `ProjectKind` | `tm`, `fixed`, `internal` | drives revenue basis (ADR-2). `Project.kind` default `tm`. |
| `BudgetPeriodType` | `month`, `quarter`, `year`, `total` | per-period budget rows (ADR-2 fork B). |
| `TimeEntryStatus` | `draft`, `submitted`, `approved`, `rejected` | approval gate (ADR-1). Only `approved` feeds cost/CPI. |
| `MilestoneStatus` | `upcoming`, `at_risk`, `met`, `missed` | from mock. |
| `IssueDependencyType` (extend) | keep `blocks`; add `FS`, `SS`, `FF`, `SF` | `blocks` = workflow gate; FS/SS/FF/SF = schedule constraint. Same table. |

### `MemberRate` (P1) — dual rate, current value only

| Field | Type | Null | FK / Index | Default |
|-------|------|------|-----------|---------|
| id | Uuid | no | @id | uuid |
| memberId | Uuid | no | → Member, `@@unique([memberId])` | — |
| costRate | Decimal(10,2) | no | — | — |
| billRate | Decimal(10,2) | no | — | — |
| currency | VarChar(3) | no | — | `"USD"` |
| hoursPerWeek | Int | no | — | 40 |
| updatedAt | DateTime | no | — | @updatedAt |

One current rate per member. Historical rates are **snapshotted onto TimeEntry at approval** (ADR-2) — no rate-versioning table.

### `Budget` (P1) — recurring per-period rows

| Field | Type | Null | FK / Index | Default |
|-------|------|------|-----------|---------|
| id | Uuid | no | @id | uuid |
| projectId | Uuid | no | → Project, `@@index([projectId, periodStart])` | — |
| amount | Decimal(12,2) | no | — | — |
| currency | VarChar(3) | no | — | `"USD"` |
| periodType | BudgetPeriodType | no | — | `month` |
| periodStart | DateTime | no | `@@unique([projectId, periodType, periodStart])` | — |
| periodEnd | DateTime | no | — | — |

Consumed compares **per period** (a month can run hot even if the total closes).

### `TimeEntry` (P1) — approval-gated, rate-snapshot at approval

| Field | Type | Null | FK / Index | Default |
|-------|------|------|-----------|---------|
| id | Uuid | no | @id | uuid |
| memberId | Uuid | no | → Member, `@@index([memberId, date])` | — |
| issueId | Uuid | **yes** | → Issue (SetNull); null = non-issue work | — |
| date | DateTime | no | `@@index([issueId, status])` | — |
| hours | Decimal(5,2) | no | — | — |
| billable | Boolean | no | — | true |
| description | String | yes | — | — |
| status | TimeEntryStatus | no | — | `draft` |
| sourceWorkLogId | Uuid | yes | → WorkLog (SetNull); provenance of promotion | — |
| costRateSnapshot | Decimal(10,2) | yes | set at approval | — |
| billRateSnapshot | Decimal(10,2) | yes | set at approval | — |
| approvedById | Uuid | yes | → Member (SetNull) | — |
| approvedAt | DateTime | yes | — | — |

WorkLog stays raw capture (unchanged). Promotion creates a `draft` TimeEntry linked via `sourceWorkLogId`. Approval stamps `cost/billRateSnapshot` from current `MemberRate` → rollups read TimeEntry alone, never join MemberRate.

### `IssueSchedule` (P3) — date-spans + baseline (1:1 with Issue)

| Field | Type | Null | FK / Index | Default |
|-------|------|------|-----------|---------|
| id | Uuid | no | @id | uuid |
| issueId | Uuid | no | → Issue, `@@unique([issueId])` | — |
| startDate | DateTime | yes | `@@index([startDate, dueDate])` | — |
| dueDate | DateTime | yes | — | — |
| progress | Int | no | 0–100 | 0 |
| estimateHours | Decimal(6,2) | yes | **hours, NOT `Issue.estimate` (story points)** | — |
| baselineStart | DateTime | yes | snapshot | — |
| baselineEnd | DateTime | yes | snapshot | — |
| baselineSetAt | DateTime | yes | trigger timestamp | — |
| group | String | yes | gantt swimlane | — |

`actualHours`, `critical` are **NOT** columns — they are read-model outputs. Baseline trigger: **cycle activation** (`upcoming → active` copies start/dueDate → baseline*; see ADR-4).

### `Milestone` + `MilestoneDeliverable` (P3)

`Milestone`: id, projectId→Project `@@index`, name, target DateTime, status `MilestoneStatus` default `upcoming`, ownerId→Member SetNull, description, metOn DateTime?.
`MilestoneDeliverable` (join): id, milestoneId→Milestone Cascade, issueId→Issue Cascade, `@@unique([milestoneId, issueId])`.

### `ProjectReadModel` (P2) — materialized derived state (table, not cache)

| Field | Type | Notes |
|-------|------|-------|
| projectId | Uuid `@id` | 1:1 Project |
| scheduleHealth / costHealth / scopeHealth / teamHealth | String | `ok\|warn\|bad` |
| spi / cpi | Decimal(5,3) | EV/PV, EV/AC |
| scopeCreep / load | Decimal(5,3) | — |
| plannedValue / earnedValue / actualCost / billedRevenue | Decimal(14,2) | EV inputs cached |
| lastCalc | DateTime | staleness marker |
| version | Int | rebuild/optimistic guard |

A **table** (not in-memory cache): survives restart and is sortable for the portfolio query across N projects, which a cache loses.

## Architecture — CQRS-lite

```
WRITE PATH (modules/*)          READ PATH (materialized)
─────────────────────          ────────────────────────
time-tracking/service  ─┐
issue state-machine    ─┼─emit→ eventBus ──subscribe──> ppm-readmodel/rollup-listener
member-rate/service    ─┤                                   │ recompute(projectId)
project-budget/service ─┘                                   ▼
                                                      ProjectReadModel (upsert, lastCalc)
                                                            │ emit "ppm.readmodel.updated"
                                                            ▼
                                  ppm-readmodel/service ──> GET /api/projects/:id/health
                                                            │
                              SSE /api/events/workspace/:wid ──> web / mcp (KAN-40)
```

New modules under `packages/api/src/modules/`: `member-rate/`, `project-budget/`, `time-tracking/`, `scheduling/`, `milestone/`, `ppm-readmodel/` (each `routes.ts`+`service.ts`+`schema.ts`). Rollup service in `ppm-readmodel/rollup.ts`; listener in `ppm-readmodel/rollup-listener.ts`.

### Invalidation map (which write → which recompute)

| Write event | Emitted by | Recompute |
|-------------|-----------|-----------|
| `time-entry.approved` / `.rejected` | time-tracking | actualCost, CPI, costHealth |
| `issue.state_changed` / progress | state-machine, scheduling | EV, SPI, scheduleHealth, scopeCreep |
| `cycle.scope_changed` | cycle | scopeCreep, scopeHealth |
| `budget.upserted` | project-budget | costHealth (per-period) |
| `member-rate.updated` | member-rate | only future approvals (snapshots immutable) |

EV formulas (read-model): `PV=Σ(estimateHours×plannedPct)`, `EV=Σ(estimateHours×progress/100)`, `AC=Σ(approved TimeEntry.hours×costRateSnapshot)`, `SPI=EV/PV`, `CPI=EV/AC`; thresholds .95/.85. Margin = revenue − cost, revenue = billedRevenue (`tm`) or active Budget Σ (`fixed`), by `Project.kind`.

## Communication — api ↔ mcp ↔ bridge ↔ web

| Surface | Addition |
|---------|----------|
| REST | `/projects/:id/rates`, `/projects/:id/budgets`, `/time-entries` (+`/promote` `/submit` `/approve`), `/projects/:id/schedule`, `/milestones`, `/projects/:id/health` |
| MCP tools | **None new.** MCP is dev-only (the dev's coding agent). Dev hours are already captured via the existing `start_work`/`stop_work` → WorkLog. Rates, budgets, approvals, milestones and health are PM/admin surface → **web + REST, never MCP**. A dev does not set their own rate or approve their own hours. |
| Bridge | Zod schemas for rate/budget/time-entry/milestone payloads (`packages/bridge/src/types.ts` pattern) |
| SSE | new event type `ppm.readmodel.updated` over existing `GET /api/events/workspace/:wid`; web subscribes for live health/inbox (KAN-40) |

Key flow — **log → promote → approve → rollup**. Actors: hours captured automatically by the dev's agent (`start_work`/`stop_work`, existing MCP). **Promotion = dev in the web** (reviews auto-captured sessions, edits hours before they count). **Approval = PM in the web.** No MCP tool sets rates/budgets/approvals.
`POST /time-entries/promote {workLogId}` → `draft` TimeEntry. `POST /:id/submit` → `submitted`. `POST /:id/approve` (PM) → status `approved`, stamps `cost/billRateSnapshot`, emits `time-entry.approved` → rollup recomputes ProjectReadModel → `ppm.readmodel.updated` SSE. `GET /projects/:id/health` reads the table directly (no compute on read path).

## Testing strategy

| Layer | What | How |
|-------|------|-----|
| Unit | EV math, margin by kind, period-budget compare | pure functions in `rollup.ts` |
| Integration | promote→approve→rollup; snapshot immutability | Prisma test db |
| E2E | health SSE updates after approval | packages/e2e |

## Migration / rollout

Additive Prisma migrations per phase; each chained PR is its own rollback boundary (`prisma migrate down` + prior read-model version). No existing column altered. `Project.kind` ships with default `tm` so existing rows migrate cleanly.

## Open questions

**Resolved here:** rate snapshot = at-approval onto TimeEntry (ADR-2); baseline trigger = cycle activation (ADR-4); `Project.kind` lives on Project as enum, default `tm`; read-model = table not cache (ADR-3); EV `AC` basis = cost (CPI), bill side tracked separately for margin.
**Deferred:** multi-currency (single-currency P1, `currency` column reserved for forward work); `plannedPct` curve source for PV (assume linear over baseline span until cycle plan data exists); EXEC↔KANON synthetic-data unification (out of scope).

**Event-delivery substrate — deferred to a DEDICATED future cycle.** The in-process `EventEmitter` bus (~73 emitters, 1 consumer today, async-rejects swallowed, no retry/durability/observability) is a known scaling risk as PPM adds consumers. Decision (Marc): do it RIGHT in its own cycle with proper infra (a real broker/queue — Redis/BullMQ, NATS or Kafka, choice open) + a documented docker-compose for self-host; refactor the dual-write there. Outbox-on-Postgres + pg-boss was considered and set aside as a smell. **This epic does NOT touch the substrate:** the read-model relies on the existing bus + the `rebuildProjectReadModel` job as backstop; notifications keep current reliability (no worse than today). Tracked as a roadmap item.

See ADRs 0001–0004 under `docs/adr/`.

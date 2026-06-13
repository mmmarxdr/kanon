# ADR-0005: Unified work-capture & scheduling data model

- Status: Accepted
- Date: 2026-06-12
- Epic: ppm-foundation
- Related: ADR-0001 (hours/approval), ADR-0002 (rates), ADR-0003 (materialization), ADR-0004 (scheduling), PDR-0002 (provenance), PDR-0003 (write policy), PRD-0004 (stage 1 estimation model)
- Supersedes: KAN-42 (folded into the central implementation ticket)

## Context

Kanon auto-captures work through MCP + AI at the dev level, and the PPM engine consumes that data. ADRs 0001–0004 decided the financial gate (WorkLog → TimeEntry → approved), the money model, the read-model strategy, and the static scheduling schema. Four capture concerns remained undecided, scattered across loose tickets and open questions:

1. **Corrections** — captured or estimated hours entered wrong must be fixable without destroying auditability.
2. **Live Gantt** — the chart must reflect reality *now*, not the plan as last edited by hand.
3. **Slip propagation** — when a task runs late, downstream tasks must visibly shift.
4. **Incidents** — unplanned work interrupts planned work; both the incident's cost and its impact on the abandoned task must be captured.

Current schema reality (`packages/api/prisma/schema.prisma`): `Issue.estimate` (story points), `Issue.dueDate`, `WorkSession` (live, heartbeat) → `WorkLog` (raw, append-only, `durationS`, `reason`, `via`), `IssueDependency` with only `blocks`, sub-issues via `Issue.parentId`. No TimeEntry, IssueSchedule, Milestone, forecast, or incident concept exists.

This ADR decides the complete data model in one piece so implementation can proceed without re-litigating the architecture per ticket.

## Decision

### D1. Three-plane schedule model: Baseline / Plan / Forecast

Every scheduled issue has up to three temporal planes:

| Plane | Storage | Who writes it | Mutability |
|-------|---------|---------------|------------|
| **Baseline** | `IssueSchedule.baselineStart/End/SetAt` | System, at cycle activation (ADR-0004) | Immutable snapshot; explicit admin re-baseline only |
| **Plan** | `IssueSchedule.startDate/dueDate` | Humans (or agents via proposal) | Freely editable — it is the commitment |
| **Forecast** | `IssueForecast` (derived table) | Forecast engine only | Fully derived; never hand-edited; rebuildable |

**The plan never auto-moves.** Automation writing plan dates would erode the meaning of commitment and flood provenance with system edits. Instead, the **forecast** cascades automatically and the Gantt renders all three planes: baseline as ghost bar, plan as the committed bar, forecast as the live overlay with slip warnings. "The Gantt updates itself" = the forecast plane updates itself.

### D2. `IssueSchedule` (1:1 Issue) + append-only `EstimateRevision`

Per ADR-0004, plus the revision concern:

```prisma
model IssueSchedule {
  issueId        String   @id
  startDate      DateTime?
  dueDate        DateTime?
  progress       Int      @default(0)        // 0-100, human/agent-reported
  estimateHours  Decimal?                    // current value, denormalized
  baselineStart  DateTime?
  baselineEnd    DateTime?
  baselineSetAt  DateTime?
}

model EstimateRevision {
  id         String   @id
  issueId    String
  hours      Decimal
  reason     String?
  authorId   String                          // Member
  via        String?                         // PDR-0002 provenance
  createdAt  DateTime
}
```

- `estimateHours` is **hours**, distinct from `Issue.estimate` story points (ADR-0004); set during the `analysis` state; agent proposes, dev confirms (PRD-0004).
- Every estimation change appends an `EstimateRevision`; `IssueSchedule.estimateHours` holds the current value. Original-vs-final estimation analysis (estimation quality, a PPM signal) reads the revision history. ActivityLog `details` JSON is not enough: typed history is queryable for EV math.
- `analysis` is added to `IssueState` between `backlog` and `todo` (`backlog → analysis → todo → in_progress`), preserving the original KAN-42 intent: analysis is investigation/estimation **before** committed work, and makes "someone is already analyzing this" visible (start_work during analysis counts as presence).

### D3. Correction policy — edit before the gate, adjust after it

Three layers, three rules:

1. **`WorkLog` is never edited.** It is raw capture (machine truth). A bad capture is simply not promoted, or promoted with corrected hours.
2. **`TimeEntry` in `draft`/`submitted` is freely editable** by its owner (hours, issue, date). Promotion from WorkLog pre-fills hours from `durationS`; the dev corrects at promote time. `sourceWorkLogId` keeps provenance either way.
3. **`TimeEntry` in `approved` is immutable.** Corrections are **adjustment entries**: a new TimeEntry with `adjustsId → original`, hours may be negative, flowing through the same draft → submitted → approved gate. Rollups sum all approved entries including adjustments.

```prisma
model TimeEntry {
  id                String   @id
  issueId           String?                   // nullable: issue-less work (ADR-0001)
  memberId          String
  hours             Decimal                   // negative allowed only when adjustsId != null
  workedOn          DateTime                  // the day the work happened
  status            TimeEntryStatus           // draft | submitted | approved | rejected
  sourceWorkLogId   String?                   // provenance: promoted from capture
  adjustsId         String?                   // self-FK: correction of an approved entry
  costRateSnapshot  Decimal?                  // copied at approval (ADR-0002)
  billRateSnapshot  Decimal?
  via               String?
  approvedById      String?
  approvedAt        DateTime?
}
```

This is accounting-style integrity: financial facts are never rewritten, only amended — and every amendment passes the same human gate (ADR-0001 thesis).

### D4. Typed dependencies + Milestones (ADR-0004, confirmed schema)

- `IssueDependencyType` gains `FS | SS | FF | SF`; `lagDays Int @default(0)` added. `blocks` keeps its workflow-gate semantics untouched.
- `Milestone(projectId, name, target, status, ownerId, metOn?)` + `MilestoneDeliverable` join to Issue.

### D5. `IssueForecast` — the derived plane and the propagation engine

```prisma
model IssueForecast {
  issueId        String   @id
  forecastStart  DateTime?
  forecastEnd    DateTime?
  slipDays       Int      @default(0)        // forecastEnd - dueDate
  critical       Boolean  @default(false)    // on the critical path
  floatDays      Int?
  inputsHash     String?                     // cheap staleness check
  computedAt     DateTime
}
```

**Forecast computation** (per project, by a `forecast-listener` on the existing event bus — same spine as ADR-0003):

- `forecastEnd(issue)` = f(actual progress vs `estimateHours`, hours already logged, remaining estimate, working calendar) — naive v1: `startActual + estimateHours·(100/progress)` style extrapolation, refined later without schema change.
- Propagation: forward pass over the typed-dependency graph honoring `lagDays`. A slipped predecessor pushes successors' `forecastStart/End`. Critical path and float fall out of the same pass (ADR-0004 D6).
- **Triggers**: `issue.state_changed`, `worklog.created`, `time-entry.approved`, `schedule.updated`, `dependency.changed`, `interruption.opened/closed`, `estimate.revised`. Debounced per project.
- **Escalation, not mutation**: when `slipDays` crosses a threshold (default: any slip on a critical-path issue, or > 2 days elsewhere), the engine emits an **McpProposal** (`kind: generic`, replan payload) suggesting a plan change — the human decides (PDR-0003 write policy). The forecast itself needs no approval because it is derived state, not a write to anyone's commitment.
- Fully derived ⇒ droppable and rebuildable (`rebuildProjectForecast(projectId)`), same operational contract as `ProjectReadModel` (ADR-0003). Project-level aggregates (scheduleHealth, SPI) read from `IssueForecast` into `ProjectReadModel`.

### D6. Incidents — first-class issues plus an `Interruption` edge

- `IssueType` gains **`incident`**. Incidents are real issues: full lifecycle, board-visible, capture and time accounting work unchanged.
- The new concept is the **interruption edge** — what the incident displaced:

```prisma
model Interruption {
  id                  String   @id
  incidentIssueId     String                  // the incident worked on
  interruptedIssueId  String                  // the task abandoned
  memberId            String
  startedAt           DateTime
  endedAt             DateTime?               // null = still interrupted
  via                 String?
}
```

- **Capture flow**: dev (or their agent) reports an incident while a `WorkSession` is active on issue A → Kanon stops A's session (normal WorkLog), opens a session on the incident, and writes an `Interruption(incident, A)`. When the dev resumes A (or the incident closes), `endedAt` stamps. MCP flow: `kanon_report_incident` (creates incident issue + performs the switch) or `kanon_start_work` on an `incident`-type issue with a session active elsewhere (implicit switch, interruption recorded). Manual interruptions (no active session) can be recorded explicitly.
- **Impact wiring**:
  - The forecast engine consumes open/closed interruptions: interrupted time extends the interrupted issue's `forecastEnd` (and cascades, D5). This is exactly "I had to drop the task — the Gantt should show the consequence."
  - Incident hours flow through the same WorkLog → TimeEntry pipeline, attributable as **unplanned work** in PPM rollups (by `Issue.type = incident`) — no parallel accounting system.
  - If the incident is pulled into the active cycle, the existing `CycleScopeEvent` records the scope change; nothing new needed.

### D7. MCP capture surface

All flows above are agent-operable, all writes carry `via` + human-owner attribution (PDR-0002), and judgment-bearing writes follow proposal-by-default (PDR-0003):

| Flow | Mode |
|------|------|
| Propose estimation during analysis | Proposal → dev confirms (PRD-0004) |
| Promote WorkLogs → TimeEntry draft | Direct (dev's own data, draft state) |
| Submit / approve time entries | Direct submit by owner; approve gated by PM role (PRD-0001) |
| Adjustment entry on approved hours | Same gate as any TimeEntry |
| Report incident / switch | Direct (capture must not have friction) |
| Re-plan after forecast slip | Proposal from the engine → human applies |

## Consequences

- One decision document; the loose tickets (KAN-42) collapse into a single implementation ticket with subtasks — backlog hygiene plus a single architectural source of truth.
- Auditability is structural: WorkLog immutable, approved TimeEntry immutable + adjustments, EstimateRevision append-only, Interruption explicit. Nothing financial or historical is ever UPDATE'd.
- The Gantt is honest: commitments (plan) only move when a human moves them; reality (forecast) moves continuously and visibly; the gap between the two IS the management signal.
- Two derived stores (`ProjectReadModel`, `IssueForecast`) ride one event spine — same rebuild/staleness contract, and the future webhook ingest (PDR-0003) joins the same spine.
- Cost: forecast pass is O(issues + deps) per project per debounce window; acceptable at Kanon's scale, and isolated behind the listener so it can be made incremental later.
- `analysis` state addition touches the state machine, MCP transition tool, board columns — bounded, listed as its own subtask.

## Alternatives considered

| Option | Rejected because |
|--------|------------------|
| Auto-move plan dates on slip | Destroys the meaning of commitment; floods provenance with system edits; PM loses the slip signal (plan vs forecast gap). |
| Editable WorkLog for corrections | Kills the "machine truth" anchor; promotion-time correction + adjustment entries cover every real case with audit intact. |
| Mutate approved TimeEntry with audit log | UPDATE on financial facts; snapshots (ADR-0002) would desync; adjustment entries are the accounting-standard answer. |
| Estimation history in ActivityLog JSON | Not queryable for EV/estimation-quality math; typed append-only table is trivial. |
| Incident as label on bug | No type-level accounting (unplanned-work bucket), no schema hook for Interruption flow, filters become string-matching. |
| Interruption inferred from session switches (no table) | Reconstruction from WorkLog adjacency is heuristic and lossy (multi-day incidents, manual interruptions); the explicit edge is one small table. |
| Forecast as columns on IssueSchedule | Mixes human-owned and derived state in one row; FK'd derived table keeps the "droppable/rebuildable" contract clean. |
| Separate incident/timesheet module outside issues | Parallel accounting system; contradicts "one source of truth" and doubles every capture path. |

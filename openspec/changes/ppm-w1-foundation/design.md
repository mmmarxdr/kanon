# Design: PPM Engine W1 Foundation (KAN-99 + KAN-100)

Implementation design against current code. ADR-0005 (D2/D3) + the issue ACs are the
accepted architecture — this document is the HOW, not a re-architecture. Quality bar:
clean, resilient, performant, correct error handling. The ppm-engine §8 invariants
become real code (service guards + DB constraints + transactions), not comments.

## Technical Approach

Two L1-canonical modules added on the existing Fastify 5 + Prisma + event-bus spine:
- **schedule** (KAN-99): `IssueSchedule` (1:1 Issue), append-only `EstimateRevision`, `analysis` state.
- **timesheet** (KAN-100): `TimeEntry` + `TimeEntryStatus`, promote/submit/approve/adjust, PM gate.

Plus three cross-cutting concerns the locked decisions require: a new `MemberRole.pm`,
a first-class **Decimal-as-string** boundary convention, and the **deprecation of `Issue.dueDate`**
in favour of `IssueSchedule.dueDate` as the single source of truth for dates.

All new service functions follow the established pattern: `fn(id, body, memberId, via?) → Promise`,
callback-form `$transaction` for atomic multi-write, fire-and-forget post-commit events wrapped
in try/catch, inline-string `AppError` codes, `via` threaded to rows and events.

---

## 1. Schema design (`packages/api/prisma/schema.prisma`)

### Enums

```prisma
enum IssueState { backlog  analysis  todo  in_progress  review  done }  // analysis inserted at index 1
enum TimeEntryStatus { draft  submitted  approved  rejected }
enum MemberRole { owner  admin  pm  member  viewer }                    // pm between admin and member
```

### Models

```prisma
model IssueSchedule {
  issueId       String    @id @db.Uuid
  issue         Issue     @relation(fields: [issueId], references: [id], onDelete: Cascade)
  startDate     DateTime? @map("start_date")
  dueDate       DateTime? @map("due_date")
  progress      Int       @default(0)                  // 0-100
  estimateHours Decimal?  @map("estimate_hours") @db.Decimal(8,2)
  baselineStart DateTime? @map("baseline_start")
  baselineEnd   DateTime? @map("baseline_end")
  baselineSetAt DateTime? @map("baseline_set_at")
  createdAt     DateTime  @default(now()) @map("created_at")
  updatedAt     DateTime  @updatedAt @map("updated_at")  // mutable plan plane
  @@map("issue_schedules")
}

model EstimateRevision {                                // append-only: createdAt only
  id        String   @id @default(uuid()) @db.Uuid
  issueId   String   @map("issue_id") @db.Uuid
  issue     Issue    @relation(fields: [issueId], references: [id], onDelete: Cascade)
  hours     Decimal  @db.Decimal(8,2)
  reason    String?
  authorId  String   @map("author_id") @db.Uuid
  author    Member   @relation(fields: [authorId], references: [id], onDelete: Restrict)
  via       String?
  createdAt DateTime @default(now()) @map("created_at")
  @@index([issueId, createdAt])
  @@map("estimate_revisions")
}

model TimeEntry {                                       // append-only fact; status mutates pre-approval
  id               String          @id @default(uuid()) @db.Uuid
  issueId          String?         @map("issue_id") @db.Uuid       // nullable: issue-less work
  issue            Issue?          @relation(fields: [issueId], references: [id], onDelete: SetNull)
  memberId         String          @map("member_id") @db.Uuid
  member           Member          @relation(fields: [memberId], references: [id], onDelete: Restrict)
  hours            Decimal         @db.Decimal(8,2)
  workedOn         DateTime        @map("worked_on")
  status           TimeEntryStatus @default(draft)
  sourceWorkLogId  String?         @unique @map("source_work_log_id") @db.Uuid   // idempotency
  sourceWorkLog    WorkLog?        @relation(fields: [sourceWorkLogId], references: [id], onDelete: SetNull)
  adjustsId        String?         @map("adjusts_id") @db.Uuid
  adjusts          TimeEntry?      @relation("Adjustments", fields: [adjustsId], references: [id], onDelete: SetNull)
  adjustedBy       TimeEntry[]     @relation("Adjustments")
  costRateSnapshot Decimal?        @map("cost_rate_snapshot") @db.Decimal(12,2)
  billRateSnapshot Decimal?        @map("bill_rate_snapshot") @db.Decimal(12,2)
  via              String?
  approvedById     String?         @map("approved_by_id") @db.Uuid
  approvedBy       Member?         @relation("ApprovedEntries", fields: [approvedById], references: [id], onDelete: SetNull)
  approvedAt       DateTime?       @map("approved_at")
  createdAt        DateTime        @default(now()) @map("created_at")
  updatedAt        DateTime        @updatedAt @map("updated_at")
  @@index([memberId, workedOn])
  @@index([issueId, status])
  @@map("time_entries")
}
```

`Issue` gains relations: `schedule IssueSchedule?`, `estimateRevisions EstimateRevision[]`, `timeEntries TimeEntry[]`. **`Issue.dueDate` removed** (see §6). `WorkLog` gains `timeEntry TimeEntry?` back-relation. `Member` gains the three back-relations.

### Decision table

| Decision | Choice | Rejected | Rationale |
|---|---|---|---|
| Decimal type | `@db.Decimal(8,2)` hours / `(12,2)` rates | Float / Int cents | Prisma `Decimal` = exact money/hours; ADR mandates Decimal; explore confirms zero precedent → set it cleanly. |
| Idempotency | `@unique sourceWorkLogId` (Postgres treats NULLs distinct → manual entries unaffected) | service-only check | At-most-one TimeEntry per WorkLog at DB level; retries can't double-promote. Inv #2 defense-in-depth. |
| Negative hours | DB `CHECK (hours >= 0 OR adjusts_id IS NOT NULL)` + service guard | service-only | Inv #3 defense-in-depth; DB is the backstop, service gives readable 422. CHECK added via raw SQL in migration (Prisma can't express it). |
| EstimateRevision mutability | `createdAt` only | updatedAt | Append-only audit table (matches WorkLog/ActivityLog pattern). |
| PM role position | `MemberRole = owner > admin > pm > member > viewer` | `admin`-as-PM proxy | Owner locked a real `pm` value. Sits above member (can approve), below admin. `ROLE_HIERARCHY` becomes `["viewer","member","pm","admin","owner"]`. |

### Migration plan (one migration dir, e.g. `<ts>_ppm_w1_foundation`)

1. **`IssueState += analysis`** — rename→create→USING→drop pattern (precedent `20260426053148_kanban_states`): drop column default, `RENAME TO IssueState_old`, `CREATE TYPE ... ('backlog','analysis','todo','in_progress','review','done')`, `ALTER COLUMN ... USING (state::text::IssueState)` (identity map — no value changes), restore default `'backlog'`, drop old type.
2. **`MemberRole += pm`** — same rename→create→USING→drop on `Member.role` AND `ProjectMember.role` (both columns use the enum; both need the `USING` cast in the same migration), identity map.
3. **`TimeEntryStatus`** — plain `CREATE TYPE`.
4. **Create tables** `issue_schedules`, `estimate_revisions`, `time_entries` with FKs/indexes/unique.
5. **`CHECK` constraint** (raw): `ALTER TABLE "time_entries" ADD CONSTRAINT time_entries_hours_sign CHECK ("hours" >= 0 OR "adjusts_id" IS NOT NULL);`
6. **dueDate backfill** (raw, before drop): `INSERT INTO issue_schedules (issue_id, due_date, progress, created_at, updated_at) SELECT id, due_date, 0, now(), now() FROM issues WHERE due_date IS NOT NULL;`
7. **Drop column** `ALTER TABLE "issues" DROP COLUMN "due_date";`

Auto-runs via `prisma migrate deploy` (Dockerfile CMD). Test DB picks it up through `pnpm test:db:setup`.

---

## 2. Service layer

### schedule module — `packages/api/src/modules/schedule/service.ts` (KAN-99)

| Fn | Signature | Tx boundary | Guards | Error codes | Events |
|---|---|---|---|---|---|
| `getSchedule` | `(issueId) → IssueSchedule \| null` | none | — | — | — |
| `upsertPlan` | `(issueId, {startDate?,dueDate?,progress?}, memberId, via?)` | single upsert | progress 0..100 → 422 `INVALID_PROGRESS`; startDate ≤ dueDate → 422 `INVALID_DATE_RANGE` | — | `schedule.updated` |
| `reviseEstimate` | `(issueId, {hours,reason?}, memberId, via?)` | **`$transaction(cb)`**: append `EstimateRevision` → upsert `IssueSchedule.estimateHours` | hours ≥ 0 → 422 `INVALID_ESTIMATE` | `ISSUE_NOT_FOUND` | `estimate.revised` |

Invariant mapping: **#9** (`estimateHours` change always appends a revision) → both writes inside ONE `reviseEstimate` transaction; there is **no** code path that sets `IssueSchedule.estimateHours` outside `reviseEstimate`. **#5/#8** (plan/baseline writers) → `upsertPlan` is the only plan writer; baseline columns are NOT written by any W1 function (cycle-activation snapshot is a later slice — leave columns null).

### timesheet module — `packages/api/src/modules/timesheet/service.ts` (KAN-100)

| Fn | Signature | Tx boundary | Guards | Error codes | Events |
|---|---|---|---|---|---|
| `promoteWorkLog` | `(workLogId, {hours?,issueId?,workedOn?}, memberId, via?)` | single create (rely on `@unique` for idempotency) | ownership (workLog.memberId === memberId) → 403; hours ≥ 0 → 422; on unique violation P2002 → return existing entry (idempotent 200) | `WORKLOG_NOT_FOUND`, `FORBIDDEN` | `worklog.promoted` (optional) |
| `updateEntry` | `(entryId, body, memberId, via?)` | single update | status ∈ {draft,submitted} else 409 `ENTRY_IMMUTABLE`; owner-only → 403; hours-sign guard | `ENTRY_NOT_FOUND` | — |
| `submitEntry` | `(entryId, memberId, via?)` | single update | status === draft else 409 `INVALID_STATUS`; owner-only | — | — |
| `approveEntry` | `(entryId, memberId, via?)` | **`$transaction(cb)`**: copy rate snapshots → set status/approvedBy/approvedAt | status === submitted else 409; **PM gate at route** | `ENTRY_NOT_FOUND` | `time-entry.approved` |
| `rejectEntry` | `(entryId, reason?, memberId, via?)` | single update | status === submitted else 409; PM gate at route | — | `time-entry.rejected` (optional) |
| `createAdjustment` | `(adjustsId, {hours,workedOn,issueId?}, memberId, via?)` | single create | target status === approved else 409 `NOT_APPROVED`; new entry starts `draft`; negative hours permitted (adjustsId set) | `ENTRY_NOT_FOUND` | — |

Invariant mapping: **#1** (WorkLog never updated) → timesheet only READS WorkLog, never writes it (promotion creates a TimeEntry). **#2** (approved immutable) → `updateEntry`/`submitEntry`/`approveEntry` all re-read status first and reject when `approved`; the ONLY mutation touching an approved entry is `createAdjustment`, which never updates the original. **#3** (negative needs adjustsId) → DB CHECK + each create/update guard. **#7** (`via` + human owner) → every fn takes `via`, stores it, passes to event; `memberId` is the human owner on every row.

Rate snapshots in `approveEntry`: read `MemberRate` for the entry's member at approval time → copy into `costRateSnapshot`/`billRateSnapshot`. **MemberRate does not exist in W1** (ADR-0002, later slice) → snapshots stay `null` for now; the copy step is a no-op hook with a `TODO(KAN-rate)` so the approval gate ships correctly and the snapshot wiring is a one-line change later. Note as open question.

---

## 3. Decimal convention

- **DB → service**: Prisma returns `Prisma.Decimal` objects (never coerce to JS number in the service — precision loss).
- **service → JSON**: Fastify `JSON.stringify` calls `.toString()` → wire value is a **string** (`"3.50"`).
- **Shared schemas** (`packages/shared/src/schedule.ts` new, `timesheet.ts` new): all hours/rate fields are `z.string()` (NOT `z.number()`, NOT `z.coerce.number()`). Document: "Decimal fields cross the boundary as strings to preserve precision."
- **Web read path**: `Number(schedule.estimateHours)` only at the display/formatting edge (e.g. inside the schedule slot component), never stored back as number in shared types. Update `use-issue-schedule.ts` `IssueSchedule.estimateHours` from `number | null` → `string | null` to match.
- **API request schemas** (`schema.ts`): accept hours as `z.string().regex(/^\d+(\.\d{1,2})?$/)` or `z.coerce` to Prisma.Decimal in the service via `new Prisma.Decimal(body.hours)`.

---

## 4. API surface

Routes registered in `packages/api/src/modules/schedule/routes.ts` and `timesheet/routes.ts`, plugged into the app like existing module routers. Pattern: `route → preHandler [requireIssueRole | requireProjectRole | requireEntryRole] → handler → service`.

| Method + path | preHandler (gate) | Zod body |
|---|---|---|
| `GET /api/issues/:key/schedule` | `requireIssueRole("key")` | — |
| `PUT /api/issues/:key/schedule` | `requireIssueRole("key","member")` | `{startDate?,dueDate?,progress?}` |
| `POST /api/issues/:key/estimate` | `requireIssueRole("key","member")` | `{hours:string, reason?}` |
| `POST /api/worklogs/:id/promote` | `requireWorkLogRole("id")` (new, gates on workLog owner's project) | `{hours?,issueId?,workedOn?}` |
| `PATCH /api/time-entries/:id` | `requireEntryRole("id")` (new) | partial entry |
| `POST /api/time-entries/:id/submit` | `requireEntryRole("id")` | — |
| `POST /api/time-entries/:id/approve` | `requireEntryRole("id","pm")` | — |
| `POST /api/time-entries/:id/reject` | `requireEntryRole("id","pm")` | `{reason?}` |
| `POST /api/time-entries/:id/adjust` | `requireEntryRole("id")` | `{hours:string,workedOn,issueId?}` |

`requireEntryRole` / `requireWorkLogRole` are two new factories in `require-role.ts` following the exact `requireDependencyRole` shape (resolve entity → its issue/project → `enforceProjectAccess`). **PM gate = `requireEntryRole("id","pm")`** — passing minRole `pm` flows through the updated `ROLE_HIERARCHY` so owner/admin/pm pass, member/viewer get 403.

---

## 5. `analysis` + board ripple (full file list)

| File | Change |
|---|---|
| `packages/api/prisma/schema.prisma` | `IssueState` enum (done above) |
| `packages/api/src/shared/constants.ts` | insert `"analysis"` at index 1 in `ORDERED_STATES` AND `ISSUE_STATES` |
| `packages/api/src/modules/issue/state-machine.ts` | no logic change (position-based); add test cases |
| `packages/api/src/modules/issue/schema.ts` | auto (uses `ISSUE_STATES` const) — verify only |
| `packages/shared/src/issue.ts` | add `"analysis"` to `issueStateSchema` enum (hardcoded) |
| `packages/mcp/src/types.ts` | add `"analysis"` to `ISSUE_STATES` (hardcoded) |
| `packages/web/src/stores/board-store.ts` | add `"analysis"` to `ISSUE_STATES`, `BOARD_COLUMNS`, `COLUMN_STATE_MAP`, `COLUMN_DEFAULT_STATE`, `COLUMN_LABELS` (`"Analysis"`), `STATE_LABELS` — 6th column **between Backlog and Todo** (1:1 state↔column) |
| `packages/web/src/features/board/kanban-board.tsx` | renders `BOARD_COLUMNS` → 6th column appears automatically |
| API/MCP role enum mirrors | `MEMBER_ROLES` const in `constants.ts` += `"pm"`; MCP types if they list roles; web role labels if any |

`MemberRole.pm` consumer ripple: `require-role.ts` `ROLE_HIERARCHY`; `constants.ts` `MEMBER_ROLES`; `packages/mcp/src/types.ts` (any role enum); shared role schema if present; seed helpers `packages/api/src/test/helpers.ts` (`seedTestMemberWithRole` / `seedTestProjectMember` accept the new value automatically as it's typed from Prisma); web member-management UI role lists.

---

## 6. dueDate deprecation (exhaustive consumer migration)

`IssueSchedule.dueDate` becomes the single source of truth. `Issue.dueDate` column dropped after backfill (§1 migration step 6-7).

| File:loc | Current | Change |
|---|---|---|
| `prisma/schema.prisma:238` | `dueDate DateTime?` on Issue | remove column |
| `api/.../issue/service.ts:134` | create writes `dueDate` | drop from create; if `body.dueDate` provided, upsert `IssueSchedule` in same tx |
| `api/.../issue/service.ts:453-454` | update writes `dueDate` | route to `scheduleService.upsertPlan` (or drop, deferring to PUT /schedule) |
| `api/.../issue/schema.ts:24,42` | `dueDate` in create/update body | keep for back-compat input → forward to schedule service, OR remove (decide — see Open Q) |
| `api/.../issue/service.test.ts:105`, `shared/.../issue.real-contract.test.ts:60,149` | fixtures reference `dueDate` | remove field from fixtures/assertions |
| `mcp/src/types.ts:120,137` | `dueDate` on create/update issue input | keep input field → MCP forwards to schedule endpoint; OR move to a schedule tool |
| `mcp/src/tools/issues.ts:87,101,120,129` | passes `dueDate` to body | forward to `PUT /schedule` after issue create/update |
| `mcp/src/transforms.ts:31` | `dueDate` in field projection | remove (no longer on Issue) |
| `mcp/src/transforms.test.ts:34`, `mcp/src/tools/issues.test.ts:49` | fixtures | remove |
| `web/.../board/use-create-issue-mutation.ts:20` | `dueDate?: string` | forward to schedule on create, or drop from create form |
| `web/.../issue-detail/use-issue-schedule.ts` | placeholder null adapter | wire to `GET /api/issues/:key/schedule`; `estimateHours` → `string\|null` |
| `web/.../issue-detail/issue-schedule-slot.tsx` | TODO placeholder | render real schedule fields |

The shared `issueSchema`/`issueDetailSchema` do **not** currently expose `dueDate`, so no removal needed there — date now lives in the schedule schema. This bounds the web read ripple.

---

## 7. Chained-PR slicing — Review Workload Forecast

Locked decisions expanded scope well past one PR. Four chained PRs (Feature Branch Chain: PR#1 → tracker branch, each child → previous).

| Slice | Contents | Est. lines (add+del) | 400 risk |
|---|---|---|---|
| **PR1 — Foundations** | `MemberRole.pm` (enum + migration + `ROLE_HIERARCHY` + `MEMBER_ROLES` + mcp/seed consumers); `analysis` state (enum migration + all 6 ripple files + board column) | ~280 | Medium |
| **PR2 — Schedule + dueDate deprecation (KAN-99 core)** | `IssueSchedule` + `EstimateRevision` models + migration + CHECK; schedule service (`getSchedule`/`upsertPlan`/`reviseEstimate`) + routes + zod; Decimal convention + shared `schedule.ts`; **dueDate backfill + drop + all consumer migration**; `estimate.revised`/`schedule.updated` events | ~400 | **High** |
| **PR3 — Timesheet (KAN-100)** | `TimeEntry` + `TimeEntryStatus` + migration; timesheet service (promote/update/submit/approve/reject/adjust) + routes + `requireEntryRole`/`requireWorkLogRole`; idempotency + immutability + adjustment guards; `time-entry.approved` event; shared `timesheet.ts` | ~390 | High |
| **PR4 — Web wiring** | `use-issue-schedule` real query; `issue-schedule-slot` render; create-issue dueDate→schedule forwarding; MCP dueDate forwarding | ~180 | Low |

**Forecast guard lines:**
- `Decision needed before apply: Yes`
- `Chained PRs recommended: Yes`
- `400-line budget risk: High`

PR2 is the dense one (model + service + cross-package dueDate refactor). If it exceeds 400, split PR2a (schedule model + service + events) from PR2b (dueDate deprecation refactor). Recommend tasks phase keep PR2 split-ready.

---

## 8. Test strategy (Strict TDD active)

Coverage thresholds must hold: **stmts 91 / branches 85 / funcs 93 / lines 91**. Every guard branch needs a test.

| Layer | What | Approach |
|---|---|---|
| Unit | each service fn — happy + every guard branch | `vi.mock("../../config/prisma.js")` (work-session/service.test.ts pattern); assert `AppError` code+status per branch; assert `$transaction` callback used for `reviseEstimate`/`approveEntry`; assert event emitted post-commit; assert immutability rejection paths |
| Unit | Decimal handling | feed `Prisma.Decimal`, assert string at boundary serialization; negative-hours guard returns 422 unless adjustsId |
| Integration | promote idempotency (P2002 → existing entry), approve PM gate (member 403 / pm 200), adjustment on approved, plan upsert, estimate revision append | real `kanon_test` DB; helpers `createTestApp`/`seedTestWorkspace`/`seedTestMemberWithRole(ws,"pm")`/`seedTestProject`/`cleanDatabase`; serial singleFork — fine |
| Integration | `analysis` transition both directions | extend `auto-transition.test.ts` / state-machine tests |
| Integration | dueDate backfill | seed Issue with due date (pre-migration fixture is tricky — test the schedule-create-on-issue-create path instead) |

Mirror `work-session/service.test.ts` mock factories (`makeWorkLog`, `makeEntry`) to keep branch coverage. New modules ship with their `*.test.ts` + `*.integration.test.ts` in the same PR slice.

---

## 9. Open questions / risks (design-review pause)

1. **MemberRate absent in W1** → `approveEntry` rate snapshots stay `null` (no-op hook + `TODO`). Confirm shipping approval without rate copy is acceptable, or pull a minimal MemberRate stub into PR3.
2. **dueDate input back-compat**: keep `dueDate` on issue create/update inputs (API+MCP+web) as a convenience that forwards to the schedule service, OR hard-remove and force callers to the schedule endpoint? Recommendation: **keep as forwarding alias** for one release to avoid breaking MCP/web flows; remove in a later cleanup.
3. **`analysis` and start_work presence**: ADR says start_work during analysis counts as presence — no W1 code change (work-session already issue-agnostic), but confirm no state guard blocks starting work in `analysis`.
4. **PR2 size**: if it busts 400 lines, split schedule-core from dueDate-deprecation (PR2a/PR2b). Decide at tasks phase.
5. **Enum migration on populated prod data**: `MemberRole`/`IssueState` rename pattern requires the `USING` cast on every column referencing the type (Member.role, ProjectMember.role for MemberRole). Verify no other table references these enums before writing the migration.
6. **`time_entries` index for rollups**: added `(memberId, workedOn)` and `(issueId, status)`; forecast/readmodel are later slices — confirm these cover their read patterns or defer index tuning.

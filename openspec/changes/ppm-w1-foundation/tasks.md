# Tasks: PPM Engine W1 Foundation (KAN-99 + KAN-100)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines — PR1 Foundations | ~280 |
| Estimated changed lines — PR2a Schedule Core | ~380 |
| Estimated changed lines — PR2b dueDate Deprecation | ~260 |
| Estimated changed lines — PR3 Timesheet | ~390 |
| Estimated changed lines — PR4 Web Wiring | ~180 |
| Total across all slices | ~1 490 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 → PR2a → PR2b → PR3 → PR4 (5 PRs) |
| Delivery strategy | auto-chain |
| Chain strategy | feature-branch-chain |

**PR2 split decision:** PR2 original estimate is ~620 lines, well above 400. SPLIT into PR2a (schedule model + service + routes + shared schema + events + tests) and PR2b (dueDate backfill migration step + all cross-package consumer migration + tests). PR2b base branch = PR2a branch.

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Base Branch |
|------|------|-----------|-------------|
| 1 | MemberRole.pm + analysis state + board col | PR1 | feature/ppm-w1-foundation |
| 2 | IssueSchedule + EstimateRevision + schedule service/routes/zod + events + tests | PR2a | PR1 branch |
| 3 | dueDate backfill migration + all consumer hard-remove + tests | PR2b | PR2a branch |
| 4 | TimeEntry + timesheet service/routes/role-factories + guards + events + tests | PR3 | PR2b branch |
| 5 | Web schedule wiring + slot render + MCP forwarding | PR4 | PR3 branch |

---

## PR1 — Foundations: MemberRole.pm + analysis state

Schema/migration first; all consumers depend on Prisma-generated types.

- [x] 1.1 **[RED]** `packages/api/src/middleware/require-role.test.ts` — add failing tests: `pm` passes `requireEntryRole("id","pm")`, `member` receives 403; hierarchy order `viewer<member<pm<admin<owner`.
- [x] 1.2 **[SCHEMA]** `packages/api/prisma/schema.prisma` — add `pm` to `MemberRole` enum (between `admin` and `member`); add `analysis` to `IssueState` enum (index 1, between `backlog` and `todo`). Run `prisma migrate dev --name ppm_w1_pr1_enums` → verify rename→create→USING→drop SQL generated for both enums covering `Member.role` AND `ProjectMember.role` columns; run `prisma generate`.
- [x] 1.3 **[GREEN]** `packages/api/src/middleware/require-role.ts` — update `ROLE_HIERARCHY` to `["viewer","member","pm","admin","owner"]`; update `meetsMinimumRole` (no logic change needed — index-based). Tests from 1.1 must pass.
- [x] 1.4 `packages/api/src/shared/constants.ts` — insert `"analysis"` at index 1 in `ORDERED_STATES` and `ISSUE_STATES`. Invariant: position-based state machine auto-handles; verify `state-machine.ts` needs no logic change.
- [x] 1.5 `packages/shared/src/issue.ts` — add `"analysis"` to `issueStateSchema` z.enum (hardcoded); add `"pm"` to any role enum exported here (check and update).
- [x] 1.6 `packages/mcp/src/types.ts` — add `"analysis"` to `ISSUE_STATES`; add `"pm"` to any role const/enum listed.
- [x] 1.7 `packages/api/src/services/event-bus/types.ts` — add `"estimate.revised"`, `"time-entry.approved"`, `"time-entry.rejected"`, `"worklog.promoted"` to `DomainEventType` union. (Done in PR1 so PR2a/PR3 can import without circular deps.)
- [x] 1.8 `packages/web/src/stores/board-store.ts` — add `"analysis"` to `ISSUE_STATES`, `BOARD_COLUMNS`, `COLUMN_STATE_MAP`, `COLUMN_DEFAULT_STATE`, `COLUMN_LABELS` (label: `"Analysis"`), `STATE_LABELS`; insert between Backlog and Todo (6th column, 1:1 state). `kanban-board.tsx` renders from `BOARD_COLUMNS` — verify auto-appears, no edit needed.
- [x] 1.9 **[TEST]** `packages/api/src/modules/issue/__tests__/auto-transition.test.ts` — add cases: transition `backlog→analysis`, `analysis→todo`, `analysis→backlog` (backward); assert direction detection correct. Run `cd packages/api && pnpm test`.
- [x] 1.10 **[REFACTOR]** `packages/api/src/modules/issue/schema.ts` — verify `z.enum(ISSUE_STATES)` picks up `analysis` automatically (no manual edit). Run `tsc --noEmit` across affected packages.

---

## PR2a — Schedule Core (KAN-99 model + service + routes + tests)

Depends on PR1 (Prisma types with new enums available).

- [ ] 2a.1 **[SCHEMA]** `packages/api/prisma/schema.prisma` — add `IssueSchedule` and `EstimateRevision` models (exact fields per design §1); add back-relations on `Issue` (`schedule IssueSchedule?`, `estimateRevisions EstimateRevision[]`); add back-relation on `Member` (`estimateRevisions EstimateRevision[]`). Run `prisma migrate dev --name ppm_w1_pr2a_schedule` → migration must include: `CREATE TABLE issue_schedules`, `CREATE TABLE estimate_revisions`, raw `ADD CONSTRAINT time_entries_hours_sign` NOT yet (time_entries in PR3) — skip the CHECK here. Run `prisma generate`; `tsc --noEmit`.
- [ ] 2a.2 `packages/shared/src/schedule.ts` — NEW file: `issueScheduleSchema` (z.object with all IssueSchedule response fields; `estimateHours: z.string().nullable()`, `startDate/dueDate: z.string().datetime().nullable()`); `estimateRevisionSchema`; export types. Convention: all Decimal fields are `z.string()` at boundary — add doc comment.
- [ ] 2a.3 `packages/api/src/modules/schedule/schema.ts` — NEW: `UpsertPlanBody` (startDate?, dueDate?, progress?), `ReviseEstimateBody` (hours: `z.string().regex(/^\d+(\.\d{1,2})?$/)`, reason?); Zod inferred types.
- [ ] 2a.4 **[RED]** `packages/api/src/modules/schedule/service.test.ts` — NEW unit test file. Mock `../../config/prisma.js` per work-session/service.test.ts pattern. Failing tests covering: `getSchedule` returns null when not found; `upsertPlan` emits `schedule.updated`; `upsertPlan` throws 422 `INVALID_PROGRESS` when progress > 100; `upsertPlan` throws 422 `INVALID_DATE_RANGE` when startDate > dueDate; `reviseEstimate` calls `$transaction` callback; `reviseEstimate` throws 422 `INVALID_ESTIMATE` when hours < 0; `reviseEstimate` throws 404 `ISSUE_NOT_FOUND`; `reviseEstimate` emits `estimate.revised` post-commit.
- [ ] 2a.5 **[GREEN]** `packages/api/src/modules/schedule/service.ts` — NEW: implement `getSchedule`, `upsertPlan`, `reviseEstimate` per design §2. `reviseEstimate` uses `prisma.$transaction(async tx => { ... })` callback form. `new Prisma.Decimal(body.hours)` for conversion. Fire-and-forget events in try/catch post-commit. All tests from 2a.4 must pass.
- [ ] 2a.6 `packages/api/src/modules/schedule/routes.ts` — NEW: register `GET /api/issues/:key/schedule`, `PUT /api/issues/:key/schedule`, `POST /api/issues/:key/estimate` with `requireIssueRole` pre-handlers; handlers call service; reply with `issueScheduleSchema` / `estimateRevisionSchema`. Plug into app router.
- [ ] 2a.7 **[RED→GREEN]** `packages/api/src/modules/schedule/schedule.integration.test.ts` — NEW: real `kanon_test` DB. Tests: `PUT /api/issues/:key/schedule` upserts plan (200); `POST /api/issues/:key/estimate` appends EstimateRevision row AND updates IssueSchedule.estimateHours atomically; `GET /api/issues/:key/schedule` returns schedule; `estimateHours` arrives as string `"3.50"` not number (Decimal boundary). Seed with `seedTestMemberWithRole(ws,"member")`. Run `pnpm test:db:setup` first.
- [ ] 2a.8 **[REFACTOR]** run `cd packages/api && pnpm test`; confirm coverage gates hold (`stmts 91 / branches 85 / funcs 93`).

---

## PR2b — dueDate Deprecation (KAN-99 consumers)

Depends on PR2a (IssueSchedule table and service exist).

- [ ] 2b.1 **[SCHEMA/MIGRATION]** `packages/api/prisma/schema.prisma` — remove `dueDate DateTime?` from `Issue` model. Run `prisma migrate dev --name ppm_w1_pr2b_dueddate_drop` → migration must include in order: raw `INSERT INTO issue_schedules ... SELECT ... FROM issues WHERE due_date IS NOT NULL` backfill (raw SQL in migration); then `ALTER TABLE "issues" DROP COLUMN "due_date"`. Verify migration SQL before applying. Run `prisma generate`; `tsc --noEmit`.
- [ ] 2b.2 `packages/api/src/modules/issue/service.ts:134` — in `createIssue`: remove `dueDate` from `prisma.issue.create` data; if `body.dueDate` provided, call `scheduleService.upsertPlan(issue.id, {dueDate: body.dueDate}, memberId, via)` in the same logical flow post-create (not in the issue create tx — schedule upsert is separate). Guard: `dueDate` input is **HARD-REMOVED** per locked decision — delete the forwarding entirely.
- [ ] 2b.3 `packages/api/src/modules/issue/service.ts:453` — in `updateIssue`: same — HARD-REMOVE `dueDate` write path. No forwarding alias.
- [ ] 2b.4 `packages/api/src/modules/issue/schema.ts:24,42` — HARD-REMOVE `dueDate` from `CreateIssueBody` and `UpdateIssueBody` Zod schemas (locked decision: callers use the schedule endpoint).
- [ ] 2b.5 `packages/api/src/modules/issue/__tests__/service.test.ts:105` and `packages/shared/src/issue.real-contract.test.ts:60,149` — remove `dueDate` from all test fixtures and assertions. Run tests to confirm no regressions.
- [ ] 2b.6 `packages/mcp/src/types.ts:120,137` — HARD-REMOVE `dueDate` from `CreateIssueInput` and `UpdateIssueInput` types (callers use the schedule endpoint, not a forwarding alias — locked decision).
- [ ] 2b.7 `packages/mcp/src/tools/issues.ts:87,101,120,129` — remove all `dueDate` reads and body forwarding; no schedule-endpoint call needed (forwarding removed per locked decision).
- [ ] 2b.8 `packages/mcp/src/transforms.ts:31` — remove `dueDate` from issue field projection (field no longer on Issue model).
- [ ] 2b.9 `packages/mcp/src/transforms.test.ts:34` and `packages/mcp/src/tools/issues.test.ts:49` — remove `dueDate` from all fixtures. Run `pnpm test` in `packages/mcp`.
- [ ] 2b.10 `packages/web/src/features/board/use-create-issue-mutation.ts:20` — remove `dueDate?: string` from mutation input; callers use the schedule endpoint. Remove from form payload.
- [ ] 2b.11 **[TEST]** `packages/api/src/modules/issue/__tests__/dueddate-removal.integration.test.ts` — NEW brief integration test: `POST /api/issues` with old `dueDate` field in body returns no error (field silently ignored OR a 400 if validation rejects it — confirm behaviour matches schema removal); `GET /api/issues/:key` response has no `dueDate` field. Run `cd packages/api && pnpm test`.

---

## PR3 — Timesheet (KAN-100)

Depends on PR2b (IssueSchedule table and `pm` role hierarchy in place).

- [ ] 3.1 **[SCHEMA]** `packages/api/prisma/schema.prisma` — add `TimeEntryStatus` enum and `TimeEntry` model (exact fields per design §1); add back-relations on `Issue` (`timeEntries TimeEntry[]`), `Member` (`timeEntries TimeEntry[]`, `approvedEntries TimeEntry[]`), `WorkLog` (`timeEntry TimeEntry?`). Run `prisma migrate dev --name ppm_w1_pr3_timesheet` → migration includes: `CREATE TYPE "TimeEntryStatus"`, `CREATE TABLE time_entries` with FKs/indexes/unique, raw `ALTER TABLE "time_entries" ADD CONSTRAINT time_entries_hours_sign CHECK ("hours" >= 0 OR "adjusts_id" IS NOT NULL)`. Run `prisma generate`; `tsc --noEmit`.
- [ ] 3.2 `packages/shared/src/timesheet.ts` — NEW: `timeEntrySchema` (all fields; `hours/costRateSnapshot/billRateSnapshot: z.string().nullable()`; `status: z.enum(["draft","submitted","approved","rejected"])`); export types. Convention doc comment matching schedule.ts.
- [ ] 3.3 `packages/api/src/modules/timesheet/schema.ts` — NEW: `PromoteWorkLogBody` (hours?, issueId?, workedOn?), `UpdateEntryBody` (partial), `ReviseAdjustBody` (hours: string regex, workedOn, issueId?), `RejectEntryBody` (reason?); Zod inferred types.
- [ ] 3.4 `packages/api/src/middleware/require-role.ts` — add `requireEntryRole(entryIdParam, ...roles)` factory (resolve TimeEntry → issue? → project → `enforceProjectAccess`; pattern identical to `requireDependencyRole`); add `requireWorkLogRole(workLogIdParam, ...roles)` factory (resolve WorkLog → issue? → project → `enforceProjectAccess`). Export both. Invariant: `request.member.id` is always workspace Member.id.
- [ ] 3.5 **[RED]** `packages/api/src/modules/timesheet/service.test.ts` — NEW unit test file. Mock prisma. Failing tests for EVERY guard branch: `promoteWorkLog` ownership 403; `promoteWorkLog` hours < 0 → 422; `promoteWorkLog` P2002 unique → returns existing (idempotent, no throw); `updateEntry` status===approved → 409 `ENTRY_IMMUTABLE`; `updateEntry` non-owner → 403; `updateEntry` hours < 0 without adjustsId → 422; `submitEntry` status!==draft → 409 `INVALID_STATUS`; `submitEntry` non-owner → 403; `approveEntry` status!==submitted → 409; `approveEntry` calls `$transaction` callback; `approveEntry` emits `time-entry.approved` post-commit; `rejectEntry` status!==submitted → 409; `createAdjustment` target!==approved → 409 `NOT_APPROVED`; `createAdjustment` allows negative hours when adjustsId set; rate snapshots are null (TODO(KAN-rate) hook present).
- [ ] 3.6 **[GREEN]** `packages/api/src/modules/timesheet/service.ts` — NEW: implement all 6 functions per design §2. `approveEntry` uses `prisma.$transaction(async tx => { ... })` callback; rate snapshot copy is a no-op `// TODO(KAN-rate): copy from MemberRate when available`. On P2002 in `promoteWorkLog`, catch Prisma error code and return existing entry. Every function accepts `via?: string | null`, stores on row, passes to event. All tests from 3.5 must pass.
- [ ] 3.7 `packages/api/src/modules/timesheet/routes.ts` — NEW: register all 9 timesheet routes (design §4) with `requireEntryRole`/`requireWorkLogRole` pre-handlers; PM gate routes pass `"pm"` as minRole. Plug into app router.
- [ ] 3.8 **[RED→GREEN]** `packages/api/src/modules/timesheet/timesheet.integration.test.ts` — NEW: real DB tests. Seed `seedTestMemberWithRole(ws,"pm")` for approval tests. Tests: promote idempotency (promote same workLogId twice → same TimeEntry id, 200); member 403 on `POST /approve`; pm 200 on `POST /approve`; `POST /adjust` on approved entry creates new draft entry; `PATCH /:id` on approved → 409; status=approved entry has `approvedAt` set; `hours` field in response is string `"2.00"`. Run `pnpm test:db:setup` first.
- [ ] 3.9 **[REFACTOR]** run `cd packages/api && pnpm test`; confirm coverage gates hold.

---

## PR4 — Web Wiring

Depends on PR3 (all API endpoints live).

- [ ] 4.1 `packages/web/src/features/issue-detail/use-issue-schedule.ts` — wire to `GET /api/issues/:key/schedule`; replace null adapter stub with real fetch. Update `IssueSchedule` type: `estimateHours: string | null` (not number). Return full schedule object.
- [ ] 4.2 `packages/web/src/features/issue-detail/issue-schedule-slot.tsx` — render real schedule fields from hook: startDate, dueDate, progress, estimateHours (display as `Number(estimateHours)` only at render edge, never stored as number). Remove TODO placeholder.
- [ ] 4.3 Verify `kanban-board.tsx` renders 6 columns including "Analysis" automatically from `BOARD_COLUMNS` (no edit needed — confirmed in 1.8). Manual smoke-check.
- [ ] 4.4 `packages/web/src/features/board/use-create-issue-mutation.ts` — confirm `dueDate` already removed in PR2b; no schedule forwarding needed (create-issue form does not forward — locked decision). If any leftover reference remains, clean up.
- [ ] 4.5 **[TEST]** Web smoke: run `pnpm tsc --noEmit` in `packages/web`; confirm no type errors on updated `estimateHours: string | null`.

---

## Sequencing Notes

- Tasks within each PR slice are **sequential** (schema → shared → service → routes → tests).
- PR slices are **strictly sequential** (feature-branch-chain): PR1 → PR2a → PR2b → PR3 → PR4.
- 3.4 (`requireEntryRole`/`requireWorkLogRole`) can be drafted alongside 3.3 but must be in the same PR3 commit so routes compile.
- Event bus type additions (1.7) are placed in PR1 so PR2a and PR3 can import types without forward references.
- `pnpm test:db:setup` must be run before any integration test slice; it is idempotent.
- Coverage gates (`stmts 91 / branches 85 / funcs 93`) must pass at the end of each PR slice before opening the PR.
- Enum migration risk: confirm no other table references `MemberRole` or `IssueState` beyond `Member.role`, `ProjectMember.role`, and `Issue.state` before writing PR1 migration.

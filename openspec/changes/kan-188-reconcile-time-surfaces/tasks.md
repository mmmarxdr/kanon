# Tasks: KAN-188 — Make reconcile-time reachable from every transition→done surface

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 550–700 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1: api (schema + reconcile + error-detail plumbing + regression test). PR2: mcp (client method + tool flow + instructions). PR3: web (both mutations + error-detail plumbing + modal + tests). |
| Delivery strategy | ask-on-risk |
| Chain strategy | sequential (api → mcp, api → web; mcp and web can proceed in parallel once api lands) |

Decision needed before apply: Yes — confirm chained-PR split (api first, then mcp/web in parallel) before starting Phase 2.
Chained PRs recommended: Yes
400-line budget risk: High

Rationale: backend touches schema.ts + reconcile.ts + 3 service.ts throw sites + the
`AppError`→client error-detail plumbing (new — see Phase 1 finding) + a regression test that
exercises a real MCP or web surface (non-trivial fixture setup). MCP touches kanon-client.ts +
issues.ts + instructions.ts + tests. Web touches both mutation hooks + a new modal component +
its own hook + tests. Each package alone is a reasonably-sized PR; all three together will not
fit the 400-line budget.

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | API: schema override + reconcile.ts stamping + via literal + 409 detail plumbing + regression test | PR 1 | Must land first — mcp/web depend on the 409 payload shape and the override field |
| 2 | MCP: client method + confirm-or-adjust tool flow + instructions doc | PR 2 | Depends on PR 1 merged (or same branch, mcp phase after api phase) |
| 3 | Web: 409 intercept (both mutations) + modal + hook + tests | PR 3 | Depends on PR 1 merged; independent of PR 2 |

---

## Phase 1: API — schema + reconcile core (test-first)

_Spec req: "Confirmed-total override on ReconcileTimeBody"_

- [x] 1.1 **RED** — `packages/api/src/modules/issue/__tests__/schema.test.ts` (create if absent): write tests for `ReconcileTimeBody` asserting: (a) a valid non-negative decimal string override alone is accepted; (b) override `> 744` is rejected; (c) override that is negative or non-decimal is rejected; (d) `addHours` AND override both provided → `.safeParse` fails (schema-level mutual exclusion, not just conditional field validation). Run `pnpm --filter @kanon/api test` — expect failure (field does not exist yet).
- [x] 1.2 **GREEN** — In `packages/api/src/modules/issue/schema.ts`, add a `confirmedTotalHours` field (decimal string, same regex/cap-744 pattern as `addHours`) to `ReconcileTimeBody`, and add a `.refine()` at the object level rejecting the case where both `addHours` and `confirmedTotalHours` are present (400 before any side effect, per the LOCKED mutual-exclusion rule — no precedence). Run tests — expect pass.

_Spec req: "Reconcile gate clearance and audit trail preserved"_

- [x] 1.3 **RED** — `packages/api/src/modules/issue/__tests__/reconcile.test.ts` (create if absent, or extend existing): write a test for `reconcileIssueTime` with a `confirmedTotalHours` opt: given an issue with N captured hours (via WorkLog/TimeEntry fixtures), reconciling with a LOWER override value results in the issue's total confirmed hours equal to the override (not N), `issue.timeConfirmedAt` is stamped, and the entry written for the override records `via: "reconcile-override"`. Add a second case with a HIGHER override value (up-correction) and a same-value case (no-op accept). Run tests — expect failure.
- [x] 1.4 **GREEN** — Extend `ReconcileOpts` in `packages/api/src/modules/issue/reconcile.ts` with `confirmedTotalHours?: string`. In `reconcileIssueTime`, when present: after Steps 1–2 (promote + bulk-approve unchanged), compute the current total from `finalEntries`-equivalent read, and write a single adjusting `TimeEntry` (positive or negative delta as the existing negative-hours-via-adjustsId convention allows, OR a corrective approved entry — pick the simplest correct approach consistent with the `TimeEntry` invariants in `schema.prisma` comments) so the resulting total equals `confirmedTotalHours` exactly, with `via: "reconcile-override"`. Preserve the existing `>=` staleness comparison and the `+1ms` stamp-past-newest-entry guard (Step 5) unchanged. Do NOT touch the `addHours` path. Run tests — expect pass.
- [x] 1.5 **RED→GREEN** — Test + confirm: when `confirmedTotalHours` is provided, the existing `addHours` top-up branch (`shouldAddHours`) is NOT invoked (mutual exclusion enforced at the service layer too, as defense-in-depth behind the schema-level 400). Assert via spy/mock that no `via: "reconcile-manual"` entry is created in the override path.

_Spec req: "Reconcile gate clearance and audit trail preserved" — via literal audit_

- [x] 1.6 Grep-confirm (already verified in this session — no code change expected): `TimeEntry.via` in `packages/api/prisma/schema.prisma` is `String?` (free-form), NOT a Prisma enum — no migration required. Confirm no separate TS/Zod union type declares `"reconcile"` / `"reconcile-manual"` as a closed set anywhere in `packages/api` or `packages/shared` (verified: none found). If Phase 1.4 introduced the `"reconcile-override"` literal as a raw string (matching the existing pattern), this task is a no-op confirmation only — do not add an enum/union that doesn't already exist.

> **Post-1.4 review-fix pass (confirmed fixes, same branch, before Phase 2 continued):**
> 1. **CRITICAL** — the negative-corrective-entry `adjustsId` anchor in `reconcile.ts` picked the entry with max `createdAt` ignoring `status`, risking linking to a draft/submitted/rejected or cross-member entry. Fixed: anchor is now selected ONLY among `status === "approved"` entries (latest by `createdAt`); added a `RECONCILE_NO_ANCHOR` (409) guard when no approved anchor exists for a downward correction, instead of writing `adjustsId: null` with negative hours (defense-in-depth for the DB CHECK `time_entries_hours_sign`). TDD: `reconcile.test.ts`.
> 2. **WARNING** — `confirmedTotalHours`'s regex allowed more than 2 decimal places (e.g. `"4.999"`), which Postgres would silently truncate against `Decimal(8,2)`, diverging the stored total from the confirmed value. Fixed: tightened to `^\d+(\.\d{1,2})?$`; `addHours`'s regex is unchanged (out of scope). TDD: `__tests__/schema.test.ts`.
> 3. Added integration coverage (`reconcile-override.integration.test.ts`) against the real Postgres test DB: downward override with an approved anchor succeeds with no CHECK violation, confirmed total matches exactly, and `timeConfirmedAt` clears the review→done gate; plus the `RECONCILE_NO_ANCHOR` 409 guard exercised end-to-end via HTTP.

---

## Phase 2: API — 409 payload plumbing for client surfaces

_Spec req: "409 payload carries captured hours for the agent to surface" (MCP) and "Single-issue transition intercepts the 409 and opens the modal" (web) — both require the ERROR CLASSES on the client side to carry `AppError.details`, which they currently do NOT._

- [x] 2.1 **RED** — `packages/api/src/modules/issue/__tests__/service.test.ts` (or existing transition test file): confirm (existing behavior, add assertion if missing) that the single-issue `transitionIssue` 409 `AppError` `details` includes `totalHours` alongside `issueKey`, `workLogs`, `timeEntries` (already true per current code at `service.ts:672-688` — this is a characterization test, not new behavior). Run — expect pass (documents the contract before client work depends on it).
  > Implemented in `packages/api/src/modules/issue/reconcile.test.ts` (the package's existing home for `transitionIssue`/`batchTransitionByKeys` reconciliation-gate tests) rather than `__tests__/service.test.ts`, whose existing mock harness only covers `createIssue`/`updateIssue`. Added two characterization tests: single-issue `details.totalHours`/`details.issueKey` (concrete values), and batch `details.blockedIssues[].totalHours` (the shape difference the tasks note explicitly). Both passed immediately — confirms Verified Fact #4 for all 3 throw sites; no service.ts changes needed.
- [x] 2.2 **RED** — `packages/web/src/lib/__tests__/api-client.test.ts` (created): write a test asserting `ApiError` thrown by `handleResponse` exposes the parsed response body's `details` (e.g. `totalHours`, `issueKey`) as a public property, not just `status`/`code`/`message`. Run `pnpm --filter @kanon/web test` — expect failure (property does not exist).
- [x] 2.3 **GREEN** — In `packages/web/src/lib/api-client.ts`, extend the `ApiError` class with a `public readonly details?: Record<string, unknown>` field, and populate it from the parsed error body in `handleResponse` (`body.details` if present, matching the shape the API's global error handler forwards from `AppError.details`). Run test — expect pass.
- [ ] 2.4 **RED** — `packages/mcp/src/__tests__/kanon-client.test.ts` (create if absent, or extend): write a test asserting `KanonApiError` exposes `details` (e.g. `totalHours`) from the parsed error body, same contract as 2.2. Run `pnpm --filter @kanon/mcp test` — expect failure.
- [ ] 2.5 **GREEN** — In `packages/mcp/src/kanon-client.ts`, extend `KanonApiError` with `public readonly details?: Record<string, unknown>`, populate it in the same `request()` error-parsing block that currently reads `code`/`message` from the response body. Run test — expect pass.

> Phase 2 is a hard prerequisite for Phase 3 (MCP) and Phase 4 (web) — the confirm-or-adjust
> flow cannot surface reported hours without this plumbing. Confirmed via direct file read: both
> `ApiError` (web) and `KanonApiError` (mcp) currently drop `AppError.details` entirely.

---

## Phase 3: MCP — reconcile client method + confirm-or-adjust tool flow

_Spec req: "MCP confirm-or-adjust flow on transition to done"_

- [x] 3.1 **RED** — `packages/mcp/src/__tests__/kanon-client.test.ts`: write a test for a new `reconcileTime(issueKey, opts)` method asserting it POSTs to `/api/issues/:key/reconcile-time` with the given body (`addHours` or `confirmedTotalHours`) and auths the same way as other client methods. Run — expect failure (method does not exist).
  > Implemented in `packages/mcp/src/kanon-client.test.ts` (co-located, not a separate `__tests__/` dir — matches this package's existing convention). 4 tests: confirmedTotalHours body, addHours body, Bearer auth, 409 details passthrough.
- [x] 3.2 **GREEN** — Add `reconcileTime(issueKey: string, opts: { addHours?: string; confirmedTotalHours?: string }): Promise<...>` to the `KanonClient` class in `packages/mcp/src/kanon-client.ts`, following the existing method pattern (see `transitionIssue`, `createIssue`) — reuse `this.request()`.
- [x] 3.3 **RED** — `packages/mcp/src/tools/__tests__/issues.test.ts` (create if absent, or extend): write a test for `kanon_transition_issue` targeting `done`: mock `client.transitionIssue` to throw a `KanonApiError` with `statusCode: 409`, `code: "RECONCILIATION_REQUIRED"`, `details: { totalHours: 5, issueKey: "ENG-1" }` on first call; assert the tool result surfaces the reported hours (e.g. in the `errorResult`/response text: "5 hours were reported..."), is NOT a hard failure the agent can't act on, and does not silently retry.
  > Implemented in `packages/mcp/src/tools/issues.test.ts` (co-located, existing convention). Also required a prerequisite: `KanonApiError` dropped `details` entirely — fixed first (constructor + `request()` error-parsing path now carry `details`), with its own RED/GREEN pair in `kanon-client.test.ts`.
- [x] 3.4 **GREEN** — In `packages/mcp/src/tools/issues.ts`, wrap the `client.transitionIssue` call in `kanon_transition_issue`: on `KanonApiError` with `code === "RECONCILIATION_REQUIRED"` and `state === "done"`, return a structured result surfacing `details.totalHours` and instructing the agent it may retry with an explicit reconcile step (accept-as-is or adjusted total) — do NOT auto-reconcile silently.
- [x] 3.5 **RED** — Add a test for a new `kanon_reconcile_time` tool (or an extended `kanon_transition_issue` input accepting an optional reconcile decision — pick ONE shape and hold it consistently) asserting: given `confirm: true` (accept-as-is), it calls `client.reconcileTime(issueKey, { confirmedTotalHours: <reported total> })` then `client.transitionIssue(issueKey, "done")`, and returns success.
  > Shape chosen: (a) a separate `kanon_reconcile_time` tool (`issueKey`, optional `confirmedTotalHours`). The agent passes the reported total explicitly to accept-as-is, or a corrected value to adjust — no boolean `confirm` flag (kept the input schema minimal since the accept/adjust decision is just the value itself). Full regression test added: 409 → `kanon_reconcile_time` → retry `kanon_transition_issue` → success.
- [x] 3.6 **GREEN** — Implement the chosen shape in `packages/mcp/src/tools/issues.ts`: either (a) a new `kanon_reconcile_time` tool taking `issueKey` and an optional `confirmedTotalHours` (omitted = accept reported total), called by the agent after seeing the 409 surfaced hours, then followed by a normal `kanon_transition_issue` retry; or (b) extend `kanon_transition_issue`'s input schema with an optional reconcile decision consumed only when a prior 409 was surfaced. Prefer (a) — matches the existing one-tool-per-action pattern (`kanon_start_work`/`kanon_stop_work` are separate tools, not flags on other tools).
- [x] 3.7 **RED→GREEN** — Test + confirm: zero captured hours (`checkReconciliation` returns `needed: false`) never surfaces a reconcile prompt — `kanon_transition_issue` to `done` succeeds directly with a single call, no 409 round-trip introduced by this change.
  > Covered by "zero captured hours transitions to done directly with a single call (no reconcile prompt)" in `issues.test.ts` — `client.transitionIssue` mocked to resolve normally, asserts `isError` undefined and exactly 1 call.

> **Byte-budget re-anchors (required by house tests, not spec-mandated):** adding the 44th
> tool (`kanon_reconcile_time`) and extending `kanon_transition_issue`'s description pushed
> two pre-existing byte-ceiling tests over budget: `descriptions.test.ts` (topline tool-
> description sum) and `instructions.test.ts` P1 (`SERVER_INSTRUCTIONS` byte ceiling).
> Re-anchored both following the exact precedent set by KAN-104/119/120 (see
> `baseline.fixture.ts` and the updated test comments) — not a scope expansion, just
> keeping the existing token-budget guardrails accurate for the new tool surface.

> **Post-Phase-3 review-fix pass (confirmed fixes, mcp-only, before PR2 merge):**
> 1. Guarded `details.totalHours` interpolation in the `kanon_transition_issue`→done 409
>    handler — a missing `details` object or non-numeric `totalHours` previously rendered
>    the literal string `"undefined hours were reported..."`. Added a `toFiniteHours()`
>    validator; invalid/absent now falls back to a generic reconcile-prompt message with
>    no interpolated value. 3 new tests in `issues.test.ts`.
> 2. Pinned (test-only, no behavior change) `kanon_batch_transition`'s current contract:
>    a `RECONCILIATION_REQUIRED` 409 from the underlying batch call surfaces via the
>    existing `errorResult` path without crashing or reporting success. Added a
>    `// KAN-188:` comment in `groups.ts` noting full batch reconcile-awareness is
>    deferred and tracked separately.
> 3. Added a contract test pinning `reconcileTime`'s mutual-exclusion propagation: passing
>    both `confirmedTotalHours` and `addHours` propagates the server's 400 as a
>    `KanonApiError` with the right statusCode/code — no client-side guard added, the
>    server is authoritative per the existing doc comment.

---

## Phase 4: Web — 409 intercept + reconcile modal (both mutations)

_Spec req: "Web confirm-or-adjust modal on transition to done"_

> PR3 implementation note: Phase 2 (2.2–2.3, `ApiError.details`) was completed
> as part of this PR's prerequisite work unit rather than a separate PR, since
> it is a hard blocker for every task below. See `packages/web/src/lib/api-client.ts`
> + `packages/web/src/lib/__tests__/api-client.test.ts`.
>
> Design deviation from the task list (documented, in-scope per "UI latitude"):
> instead of a standalone `use-reconcile-transition.ts` orchestration hook,
> `useTransitionMutation`/`useGroupTransitionMutation` each own their own
> reconcile state and expose it directly (`reconcileState`/`blockedIssues` +
> `confirmReconcile`/`cancelReconcile`). This avoids duplicating the mutation's
> own `mutate`/`mutateAsync` plumbing in a second hook and keeps the 409
> interception + retry co-located with the mutation that owns the cache
> invalidation contract.

- [x] 4.1 **RED** — `packages/web/src/features/board/use-transition-mutation.reconcile.test.tsx`: write a test where `fetchApi` rejects with `ApiError(409, "RECONCILIATION_REQUIRED", ..., details: { totalHours: 3 })`; assert the mutation surfaces this distinctly (e.g. via a returned/thrown typed error, or a callback) so a consuming component can detect the reconcile-required case and NOT treat it as a generic error toast (current `onError` unconditionally shows the "reverted" toast — this must be bypassed for the 409 case).
- [x] 4.2 **GREEN** — In `packages/web/src/features/board/use-transition-mutation.ts`, in `onError`, branch on `err instanceof ApiError && err.code === "RECONCILIATION_REQUIRED"`: skip the generic revert-toast path and instead surface the error via a `reconcileState` returned by the hook. Preserve the rollback (`setQueryData` to `previousIssues`) in all cases — only the toast/notification branch changes.
- [x] 4.3 **RED** — Same pattern for `packages/web/src/features/board/use-group-transition-mutation.reconcile.test.tsx`: the group endpoint's 409 carries `blockedIssues: [{ key, totalHours }, ...]` (per-issue, not a single `totalHours`) — assert the mutation surfaces this list distinctly so the caller can open one modal per blocked issue.
- [x] 4.4 **GREEN** — Mirror the 4.2 branch in `use-group-transition-mutation.ts`, surfacing `err.details.blockedIssues` as `blockedIssues` instead of a single `totalHours`.
- [x] 4.5 **RED** — `packages/web/src/features/board/reconcile-modal.test.tsx`: write a `@testing-library/react` test for a `ReconcileModal` component: renders captured hours, allows an optional numeric adjustment input, has a confirm action that is disabled/absent until explicitly triggered (no one-click silent path), and on confirm calls an `onConfirm(confirmedTotalHours)` callback with either the unmodified reported value or the adjusted value.
- [x] 4.6 **GREEN** — Create `packages/web/src/features/board/reconcile-modal.tsx` following the `close-cycle-dialog.tsx` pattern (`useEscapeKey`, `useBackdropClose`, `FocusTrap`, local style constants) — a controlled modal taking `totalHours: number`, `onConfirm: (confirmedTotalHours: number) => void`, `onClose: () => void`. Client-side validation mirrors the server rule (non-negative, ≤2 decimals, ≤744).
- [x] 4.7 **RED** — Covered by 4.1/4.3's `confirmReconcile` assertions (no separate orchestration hook — see design deviation note above): each mutation's own test asserts `confirmReconcile` calls `POST /api/issues/:key/reconcile-time` with `confirmedTotalHours`, then retries the transition, and that the SAME `issueKeys`/`cycleKeys` `onSettled` invalidation fires afterward.
- [x] 4.8 **GREEN** — Implemented directly on each mutation hook (`confirmReconcile`/`cancelReconcile` on both `use-transition-mutation.ts` and `use-group-transition-mutation.ts`) rather than a separate `use-reconcile-transition.ts` — see design deviation note. `onSettled`/its shared `invalidate()` helper fires through the existing `issueKeys`/`cycleKeys` factories, no new invalidation path introduced.
- [x] 4.9 **RED→GREEN** — Wired `KanbanBoard` (single transition) and `GroupedBoard` (group transition, one modal at a time keyed by `blockedIssues[0]`) to render `ReconcileModal` from each mutation's own state. Integration tests: `kanban-board.reconcile.test.tsx`, `grouped-board.reconcile.test.tsx` — assert the modal opens when the mutation surfaces reconcile state, confirm/cancel call through to the right hook methods with the right issue key + hours, and (via the unit-level mutation tests) the transition only completes after explicit confirm.

> **Post-4.9 review-fix pass (confirmed fixes, same PR3 branch `feat/kan-188-web-reconcile`):**
> 1. `confirmReconcile` in both hooks had no try/catch around the reconcile-time
>    POST + retried transition, and both boards called it as
>    `void confirmReconcile(...)` — a rejection (e.g. 409 RECONCILE_NO_ANCHOR
>    on a downward correction with no approved anchor) became an unhandled
>    promise rejection: no toast, stuck modal. Fixed in both hooks with
>    try/catch/finally, surfacing errors via the existing toast mechanism and
>    keeping the affected issue actionable/retryable (`reconcileState` only
>    clears on full success; `blockedIssues` keeps the issue on failure).
> 2. `ReconcileModal`'s `isSubmitting` prop was never passed by either board,
>    so a rapid double-click could fire `confirmReconcile` twice. Added
>    `isSubmitting` state to both hooks and wired it at both call sites.
> 3. `toFiniteHours`, the `reconcileTime` POST helper, and the
>    `"RECONCILIATION_REQUIRED"` literal were duplicated byte-for-byte across
>    both hooks — extracted to `packages/web/src/features/board/reconcile-api.ts`
>    (`RECONCILIATION_ERROR_CODE` constant) and imported by both. Also
>    collapsed the double-cast in `parseBlockedIssues`.
> 4. Added `grouped-board.reconcile-sequencing.test.tsx` pinning that
>    `blockedIssues[0]`-driven sequencing surfaces each blocked issue's own
>    hours in turn (no production change — already correct, now covered).
> 5. Minor: fixed a stale docblock comment (claimed `{ toState }`, actual wire
>    body is `{ to_state }`); switched `reconcile-modal.test.tsx` button
>    interactions to `getByRole` where the visible label already supported it.

---

## Phase 5: Docs

_No spec req directly, but required by house rules when the MCP toolset changes._

- [x] 5.1 Update `packages/mcp/src/instructions.ts` (or wherever the MCP tool list / capability doc lives) to document the new reconcile tool/flow: when `kanon_transition_issue` to `done` is blocked by `RECONCILIATION_REQUIRED`, the agent should surface reported hours and call the reconcile tool (accept-as-is or adjusted) before retrying.
  > `kanon_reconcile_time` added to CORE TOOLS list; one concise hint line added ("Done blocked by unconfirmed time -> kanon_reconcile_time, then retry"). Instructions byte ceiling re-anchored 1900→1950 (actual: 1901 B).

---

## Phase 6: Regression gate (REQUIRED — spec-mandated)

_Spec req: "Regression gate for the full capture-to-done path"_

- [x] 6.1 **RED** — Write ONE end-to-end regression test proving `start_work → stop_work → transition→done` succeeds through a REAL client-facing surface.
  **Deviation from the (a)/(b) options originally sketched here (documented, in-scope)**: implemented as a Playwright e2e in `packages/e2e/tests/reconcile-time-to-done.spec.ts` instead — a strictly stronger form of the same requirement, since it drives a real running web app (real drag-and-drop, the only UI path that invokes `useTransitionMutation` — no button/select alternative exists) against a real running api (real HTTP `work-sessions`, `transition`, `reconcile-time` endpoints), with a real Postgres DB, rather than a mocked/unit-level integration test. `start_work`/`stop_work` go through `POST`/`DELETE /api/issues/:key/work-sessions`; the transition goes through a real UI drag onto the Done column; the reconcile confirmation is a real click on `ReconcileModal`'s "Confirm & move to done" button, which calls the real `POST /api/issues/:key/reconcile-time`. The anti-regression assertion is that `[data-testid="reconcile-modal"]` (role="dialog") MUST become visible — if the 409 were dead-ended or swallowed anywhere in the client, this assertion (not a generic "did not throw") fails the test.
- [x] 6.2 **GREEN** — Regression test EXECUTED and PASSED 3x consecutively (not flaky) against the full running stack (api + web + `kanon_e2e` Postgres). Request log confirms the real gate fired: `POST /transition` → 409 RECONCILIATION_REQUIRED, `POST /reconcile-time` → 200, `POST /transition` (retry) → 200, issue lands in Done. See sdd/kan-188-reconcile-time-surfaces/apply-progress for the exact run command and two bugs caught/fixed along the way (a `MIN_WORKLOG_DURATION_S` floor false-pass risk in the test's own timing, and a `Content-Type` bug in a new `apiDelete` e2e helper).

---

## Phase 7: Manual smoke + full sweep

- [ ] 7.1 Run `pnpm --filter @kanon/shared build` (test-prerequisite only, per house rule) then `pnpm --filter @kanon/api test` — full suite green.
- [ ] 7.2 Run `pnpm --filter @kanon/mcp test` — full suite green.
- [ ] 7.3 Run `pnpm --filter @kanon/web test` — full suite green.
- [ ] 7.4 Manual smoke (web): create an issue, start work, stop work, drag to `done` on the board — confirm the reconcile modal opens, shows captured hours, allows an adjustment, and completing it lands the issue in `done`.
- [ ] 7.5 Manual smoke (web): repeat via a group/bulk transition with at least 2 issues, one with captured time and one without — confirm only the one with captured time shows a modal, and both land in `done`.
- [ ] 7.6 Spot-check: confirm the CLI's read-only `status` command is untouched (no reconcile capability added — explicit non-goal).

> Sequential — runs after all prior phases land.

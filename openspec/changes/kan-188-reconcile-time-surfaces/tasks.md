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

- [ ] 1.1 **RED** — `packages/api/src/modules/issue/__tests__/schema.test.ts` (create if absent): write tests for `ReconcileTimeBody` asserting: (a) a valid non-negative decimal string override alone is accepted; (b) override `> 744` is rejected; (c) override that is negative or non-decimal is rejected; (d) `addHours` AND override both provided → `.safeParse` fails (schema-level mutual exclusion, not just conditional field validation). Run `pnpm --filter @kanon/api test` — expect failure (field does not exist yet).
- [ ] 1.2 **GREEN** — In `packages/api/src/modules/issue/schema.ts`, add a `confirmedTotalHours` field (decimal string, same regex/cap-744 pattern as `addHours`) to `ReconcileTimeBody`, and add a `.refine()` at the object level rejecting the case where both `addHours` and `confirmedTotalHours` are present (400 before any side effect, per the LOCKED mutual-exclusion rule — no precedence). Run tests — expect pass.

_Spec req: "Reconcile gate clearance and audit trail preserved"_

- [ ] 1.3 **RED** — `packages/api/src/modules/issue/__tests__/reconcile.test.ts` (create if absent, or extend existing): write a test for `reconcileIssueTime` with a `confirmedTotalHours` opt: given an issue with N captured hours (via WorkLog/TimeEntry fixtures), reconciling with a LOWER override value results in the issue's total confirmed hours equal to the override (not N), `issue.timeConfirmedAt` is stamped, and the entry written for the override records `via: "reconcile-override"`. Add a second case with a HIGHER override value (up-correction) and a same-value case (no-op accept). Run tests — expect failure.
- [ ] 1.4 **GREEN** — Extend `ReconcileOpts` in `packages/api/src/modules/issue/reconcile.ts` with `confirmedTotalHours?: string`. In `reconcileIssueTime`, when present: after Steps 1–2 (promote + bulk-approve unchanged), compute the current total from `finalEntries`-equivalent read, and write a single adjusting `TimeEntry` (positive or negative delta as the existing negative-hours-via-adjustsId convention allows, OR a corrective approved entry — pick the simplest correct approach consistent with the `TimeEntry` invariants in `schema.prisma` comments) so the resulting total equals `confirmedTotalHours` exactly, with `via: "reconcile-override"`. Preserve the existing `>=` staleness comparison and the `+1ms` stamp-past-newest-entry guard (Step 5) unchanged. Do NOT touch the `addHours` path. Run tests — expect pass.
- [ ] 1.5 **RED→GREEN** — Test + confirm: when `confirmedTotalHours` is provided, the existing `addHours` top-up branch (`shouldAddHours`) is NOT invoked (mutual exclusion enforced at the service layer too, as defense-in-depth behind the schema-level 400). Assert via spy/mock that no `via: "reconcile-manual"` entry is created in the override path.

_Spec req: "Reconcile gate clearance and audit trail preserved" — via literal audit_

- [ ] 1.6 Grep-confirm (already verified in this session — no code change expected): `TimeEntry.via` in `packages/api/prisma/schema.prisma` is `String?` (free-form), NOT a Prisma enum — no migration required. Confirm no separate TS/Zod union type declares `"reconcile"` / `"reconcile-manual"` as a closed set anywhere in `packages/api` or `packages/shared` (verified: none found). If Phase 1.4 introduced the `"reconcile-override"` literal as a raw string (matching the existing pattern), this task is a no-op confirmation only — do not add an enum/union that doesn't already exist.

---

## Phase 2: API — 409 payload plumbing for client surfaces

_Spec req: "409 payload carries captured hours for the agent to surface" (MCP) and "Single-issue transition intercepts the 409 and opens the modal" (web) — both require the ERROR CLASSES on the client side to carry `AppError.details`, which they currently do NOT._

- [ ] 2.1 **RED** — `packages/api/src/modules/issue/__tests__/service.test.ts` (or existing transition test file): confirm (existing behavior, add assertion if missing) that the single-issue `transitionIssue` 409 `AppError` `details` includes `totalHours` alongside `issueKey`, `workLogs`, `timeEntries` (already true per current code at `service.ts:672-688` — this is a characterization test, not new behavior). Run — expect pass (documents the contract before client work depends on it).
- [ ] 2.2 **RED** — `packages/web/src/lib/__tests__/api-client.test.ts` (create if absent): write a test asserting `ApiError` thrown by `handleResponse` exposes the parsed response body's `details` (e.g. `totalHours`, `issueKey`) as a public property, not just `status`/`code`/`message`. Run `pnpm --filter @kanon/web test` — expect failure (property does not exist).
- [ ] 2.3 **GREEN** — In `packages/web/src/lib/api-client.ts`, extend the `ApiError` class with a `public readonly details?: Record<string, unknown>` field, and populate it from the parsed error body in `handleResponse` (`body.details` if present, matching the shape the API's global error handler forwards from `AppError.details`). Run test — expect pass.
- [ ] 2.4 **RED** — `packages/mcp/src/__tests__/kanon-client.test.ts` (create if absent, or extend): write a test asserting `KanonApiError` exposes `details` (e.g. `totalHours`) from the parsed error body, same contract as 2.2. Run `pnpm --filter @kanon/mcp test` — expect failure.
- [ ] 2.5 **GREEN** — In `packages/mcp/src/kanon-client.ts`, extend `KanonApiError` with `public readonly details?: Record<string, unknown>`, populate it in the same `request()` error-parsing block that currently reads `code`/`message` from the response body. Run test — expect pass.

> Phase 2 is a hard prerequisite for Phase 3 (MCP) and Phase 4 (web) — the confirm-or-adjust
> flow cannot surface reported hours without this plumbing. Confirmed via direct file read: both
> `ApiError` (web) and `KanonApiError` (mcp) currently drop `AppError.details` entirely.

---

## Phase 3: MCP — reconcile client method + confirm-or-adjust tool flow

_Spec req: "MCP confirm-or-adjust flow on transition to done"_

- [ ] 3.1 **RED** — `packages/mcp/src/__tests__/kanon-client.test.ts`: write a test for a new `reconcileTime(issueKey, opts)` method asserting it POSTs to `/api/issues/:key/reconcile-time` with the given body (`addHours` or `confirmedTotalHours`) and auths the same way as other client methods. Run — expect failure (method does not exist).
- [ ] 3.2 **GREEN** — Add `reconcileTime(issueKey: string, opts: { addHours?: string; confirmedTotalHours?: string }): Promise<...>` to the `KanonClient` class in `packages/mcp/src/kanon-client.ts`, following the existing method pattern (see `transitionIssue`, `createIssue`) — reuse `this.request()`.
- [ ] 3.3 **RED** — `packages/mcp/src/tools/__tests__/issues.test.ts` (create if absent, or extend): write a test for `kanon_transition_issue` targeting `done`: mock `client.transitionIssue` to throw a `KanonApiError` with `statusCode: 409`, `code: "RECONCILIATION_REQUIRED"`, `details: { totalHours: 5, issueKey: "ENG-1" }` on first call; assert the tool result surfaces the reported hours (e.g. in the `errorResult`/response text: "5 hours were reported..."), is NOT a hard failure the agent can't act on, and does not silently retry.
- [ ] 3.4 **GREEN** — In `packages/mcp/src/tools/issues.ts`, wrap the `client.transitionIssue` call in `kanon_transition_issue`: on `KanonApiError` with `code === "RECONCILIATION_REQUIRED"` and `state === "done"`, return a structured result surfacing `details.totalHours` and instructing the agent it may retry with an explicit reconcile step (accept-as-is or adjusted total) — do NOT auto-reconcile silently.
- [ ] 3.5 **RED** — Add a test for a new `kanon_reconcile_time` tool (or an extended `kanon_transition_issue` input accepting an optional reconcile decision — pick ONE shape and hold it consistently) asserting: given `confirm: true` (accept-as-is), it calls `client.reconcileTime(issueKey, { confirmedTotalHours: <reported total> })` then `client.transitionIssue(issueKey, "done")`, and returns success.
- [ ] 3.6 **GREEN** — Implement the chosen shape in `packages/mcp/src/tools/issues.ts`: either (a) a new `kanon_reconcile_time` tool taking `issueKey` and an optional `confirmedTotalHours` (omitted = accept reported total), called by the agent after seeing the 409 surfaced hours, then followed by a normal `kanon_transition_issue` retry; or (b) extend `kanon_transition_issue`'s input schema with an optional reconcile decision consumed only when a prior 409 was surfaced. Prefer (a) — matches the existing one-tool-per-action pattern (`kanon_start_work`/`kanon_stop_work` are separate tools, not flags on other tools).
- [ ] 3.7 **RED→GREEN** — Test + confirm: zero captured hours (`checkReconciliation` returns `needed: false`) never surfaces a reconcile prompt — `kanon_transition_issue` to `done` succeeds directly with a single call, no 409 round-trip introduced by this change.

---

## Phase 4: Web — 409 intercept + reconcile modal (both mutations)

_Spec req: "Web confirm-or-adjust modal on transition to done"_

- [ ] 4.1 **RED** — `packages/web/src/features/board/__tests__/use-transition-mutation.test.tsx` (create if absent): write a test where `fetchApi` rejects with `ApiError(409, "RECONCILIATION_REQUIRED", ..., details: { totalHours: 3 })`; assert the mutation surfaces this distinctly (e.g. via a returned/thrown typed error, or a callback) so a consuming component can detect the reconcile-required case and NOT treat it as a generic error toast (current `onError` unconditionally shows the "reverted" toast — this must be bypassed for the 409 case).
- [ ] 4.2 **GREEN** — In `packages/web/src/features/board/use-transition-mutation.ts`, in `onError`, branch on `err instanceof ApiError && err.code === "RECONCILIATION_REQUIRED"`: skip the generic revert-toast path and instead surface the error (e.g. re-throw, or expose via a returned discriminated result) so the calling component can open the reconcile modal. Preserve the rollback (`setQueryData` to `previousIssues`) in all cases — only the toast/notification branch changes.
- [ ] 4.3 **RED** — Same pattern for `packages/web/src/features/board/__tests__/use-group-transition-mutation.test.tsx` (create if absent): the group endpoint's 409 carries `blockedIssues: [{ key, totalHours }, ...]` (per-issue, not a single `totalHours`) — assert the mutation surfaces this list distinctly so the caller can open one modal per blocked issue.
- [ ] 4.4 **GREEN** — Mirror the 4.2 branch in `use-group-transition-mutation.ts`, surfacing `err.details.blockedIssues` instead of a single `totalHours`.
- [ ] 4.5 **RED** — `packages/web/src/features/board/__tests__/reconcile-modal.test.tsx` (new component, new test): write a `@testing-library/react` test for a `ReconcileModal` component: renders captured hours, allows an optional numeric adjustment input, has a confirm action that is disabled/absent until explicitly triggered (no one-click silent path), and on confirm calls an `onConfirm(confirmedTotalHours)` callback with either the unmodified reported value or the adjusted value.
- [ ] 4.6 **GREEN** — Create `packages/web/src/features/board/reconcile-modal.tsx` following the `close-cycle-dialog.tsx` pattern (`useEscapeKey`, `useBackdropClose`, `FocusTrap`, local style constants) — a controlled modal taking `totalHours: number`, `onConfirm: (confirmedTotalHours: number) => void`, `onClose: () => void`.
- [ ] 4.7 **RED** — `packages/web/src/features/board/__tests__/use-reconcile-transition.test.tsx` (new hook, new test): write a test for a small orchestration hook/function that, given a blocked issue key and a confirmed total, calls `POST /api/issues/:key/reconcile-time` with `confirmedTotalHours`, then calls the transition mutation again for `done`, and on success invalidates via the SAME `issueKeys`/`cycleKeys` factories already used in `onSettled` (reuse, do not duplicate invalidation logic).
- [ ] 4.8 **GREEN** — Implement the orchestration hook (e.g. `use-reconcile-transition.ts`) wiring `ReconcileModal` → `POST /api/issues/:key/reconcile-time` (via `fetchApi`) → retry `useTransitionMutation`'s `mutate` for `done` → confirm `onSettled` invalidation fires through existing `issueKeys`/`cycleKeys` factories (no new invalidation path).
- [ ] 4.9 **RED→GREEN** — Wire the board's transition call site(s) (wherever `useTransitionMutation`/`useGroupTransitionMutation` are consumed — locate via the existing board drag/drop or bulk-action component) to open `ReconcileModal` when the mutation surfaces `RECONCILIATION_REQUIRED`, and to open ONE modal per blocked issue for the group case (sequential or list-based UI — implementation detail, but each blocked issue MUST get its own confirm step per spec). Add/extend an integration test at the consuming component level asserting the modal opens on 409 and the transition completes only after confirm.

---

## Phase 5: Docs

_No spec req directly, but required by house rules when the MCP toolset changes._

- [ ] 5.1 Update `packages/mcp/src/instructions.ts` (or wherever the MCP tool list / capability doc lives) to document the new reconcile tool/flow: when `kanon_transition_issue` to `done` is blocked by `RECONCILIATION_REQUIRED`, the agent should surface reported hours and call the reconcile tool (accept-as-is or adjusted) before retrying.

---

## Phase 6: Regression gate (REQUIRED — spec-mandated)

_Spec req: "Regression gate for the full capture-to-done path"_

- [ ] 6.1 **RED** — Write ONE end-to-end regression test proving `start_work → stop_work → transition→done` succeeds through a REAL client-facing surface — either:
  - (a) an MCP integration test in `packages/mcp/src/tools/__tests__/` calling `kanon_start_work` → `kanon_stop_work` → `kanon_transition_issue` (409) → the new reconcile tool → `kanon_transition_issue` (success), with `client` methods hitting a mocked or real API layer (per existing MCP test conventions — check how other MCP integration tests are structured, e.g. do they mock `fetch` or spin up a test API instance); OR
  - (b) a web integration test using `@testing-library/react` exercising `useStartWorkMutation` (if it exists) → `useStopWorkMutation` → `useTransitionMutation` (409) → `ReconcileModal` confirm → retry, asserting `done` is reached.
  Pick ONE surface (MCP recommended — it is the primary agent-facing path per the proposal's "make it work again for the dev (MCP agent)" framing). The test MUST fail if any step is reachable only via a direct service-layer call (e.g. calling `reconcileIssueTime` or `transitionIssue` service functions directly bypasses this gate by design — the test must go through the tool/mutation layer).
- [ ] 6.2 **GREEN** — Run the regression test and confirm it passes end-to-end once Phases 1–4 are implemented. This is the single highest-priority test in this change — it is the proposal's stated risk mitigation ("Backend-only ships again (unreachable)").

---

## Phase 7: Manual smoke + full sweep

- [ ] 7.1 Run `pnpm --filter @kanon/shared build` (test-prerequisite only, per house rule) then `pnpm --filter @kanon/api test` — full suite green.
- [ ] 7.2 Run `pnpm --filter @kanon/mcp test` — full suite green.
- [ ] 7.3 Run `pnpm --filter @kanon/web test` — full suite green.
- [ ] 7.4 Manual smoke (web): create an issue, start work, stop work, drag to `done` on the board — confirm the reconcile modal opens, shows captured hours, allows an adjustment, and completing it lands the issue in `done`.
- [ ] 7.5 Manual smoke (web): repeat via a group/bulk transition with at least 2 issues, one with captured time and one without — confirm only the one with captured time shows a modal, and both land in `done`.
- [ ] 7.6 Spot-check: confirm the CLI's read-only `status` command is untouched (no reconcile capability added — explicit non-goal).

> Sequential — runs after all prior phases land.

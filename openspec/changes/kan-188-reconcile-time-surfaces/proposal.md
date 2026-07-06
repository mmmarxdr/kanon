# Proposal: KAN-188 — Make reconcile-time reachable from every transition→done surface

## Intent

Moving an issue to `done` with unconfirmed captured (auto-tracked) worklog time returns
`409 RECONCILIATION_REQUIRED` and leaves the user at a dead-end. The reconcile-time GATE and
the reconcile ENDPOINT shipped in the SAME commit (KAN-157 slice 1, backend-only), so every
instance that throws the 409 already HAS `POST /api/issues/:key/reconcile-time`. The real gap:
that endpoint is not reachable from any client — no MCP tool, no web action. The gate clears
ONLY by stamping `timeConfirmedAt`, which ONLY `reconcileIssueTime` does; `approve`/`promote`/
`submit` never touch it, so the user's manual workaround can never clear it. This makes
transition→done work again for the dev (MCP agent) and the PM/dev (web board) on every surface.

## Scope

### In Scope
- **MCP**: reconcile capability + `kanon-client` method; on 409, agent surfaces reported hours,
  user accepts OR changes-and-confirms, then reconcile + retry done.
- **Web**: intercept 409 in the transition mutations → modal showing captured hours with optional
  adjustment → confirm → reconcile → retry done (not a silent one-click).
- **API**: resolve additive-only limitation (see Approach) + regression test proving
  `start_work → stop_work → transition→done` is green through the reconcile path.
- **shared**: reconcile request/response type if promoted to a shared Zod schema.

### Out of Scope
- **CLI**: only has a read-only `status` command; it does NOT transition→done. Explicit non-goal.
- Redesigning the reconciliation / `approve` model. Keep current semantics. No new ADR.
- Making ask-and-confirm-hours configurable at instance level — deferred (future work).

## Capabilities

### New Capabilities
- `reconcile-time-surfaces`: reachable confirm-or-adjust reconcile flow on MCP + web for
  transition→done, incl. the 409 intercept, hours-adjustment contract, and regression gate.

### Modified Capabilities
- None (no existing capability's spec-level requirements change; the gate behavior is preserved).

## Approach

- **Additive-only fix (RECOMMENDED)**: `ReconcileTimeBody.addHours` is `>= 0` top-up only and
  cannot correct downward. Extend `ReconcileTimeBody` (`packages/api/src/modules/issue/schema.ts`)
  with an explicit **confirmed-total override** and update `reconcileIssueTime`
  (`packages/api/src/modules/issue/reconcile.ts`) to stamp that total. Rationale: one endpoint,
  atomic, matches "change the hours" (up or down), no pre-step ordering hazard, no Prisma change.
  - Alt (a) pre-reconcile edit via `adjust_time_entry`/`update_time_entry` then reconcile →
    rejected: multi-call, race-prone, harder to make atomic per surface.
  - Alt (b) accept-as-is + additive-only now, defer downward edit → rejected: fails the locked
    "user can change the hours" requirement.
- MCP + web both call the SAME reconcile path; no divergent semantics.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/api/src/modules/issue/schema.ts` | Modified | `ReconcileTimeBody` gains confirmed-total override |
| `packages/api/src/modules/issue/reconcile.ts` | Modified | Stamp confirmed total; keep additive path |
| `packages/mcp/src/tools/issues.ts` | Modified | Reconcile capability on transition→done |
| `packages/mcp/src/kanon-client.ts` | Modified | `reconcileTime` client method |
| `packages/web/src/features/board/use-transition-mutation.ts` | Modified | 409 intercept → modal → retry |
| `packages/web/src/features/board/use-group-transition-mutation.ts` | Modified | Same 409 intercept |
| `packages/shared` | Modified | Reconcile request/response type (if shared) |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Backend-only ships again (unreachable) | High impact | Regression gate: start→stop→done through reconcile MUST be green |
| Override lets hours go negative/invalid | Med | Zod-validate confirmed total `>= 0` at the boundary |
| Web group-transition skips a member's gate | Med | Intercept 409 in BOTH transition mutations, per-issue |
| Scope creep into reconcile redesign | Med | Locked non-goal; semantics preserved |

## Rollback Plan

**No Prisma migration** — schema.prisma is untouched (no rollback plan required per config rules).
Rollback = revert the commits: web reverts to the raw 409 dead-end, MCP loses the reconcile tool,
API reverts the `ReconcileTimeBody` override. No data cleanup, no migration to reverse.

## Dependencies

- None. Reuses the existing `POST /api/issues/:key/reconcile-time` endpoint and `requireIssueRole`.

## Success Criteria

- [ ] Transition→done with unconfirmed captured time succeeds via reconcile on MCP AND web.
- [ ] User can accept reported hours OR change them (up or down) before done.
- [ ] Regression test: `start_work → stop_work → transition→done` green through reconcile.
- [ ] No Prisma migration; CLI unchanged (documented non-goal).

# Tasks: Safe Redmine Outbound Comments

Three deployable, rollbackable feature-chain slices; no migrations, private/edit/delete sync, authorship, UI, or polling expansion.

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | PR1 260; PR2 390; PR3 390 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Delivery strategy | ask-on-risk |
| Chain strategy | feature-branch-chain |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

## Chain and work units

Tracker `feat/kan-230-redmine-outbound-comments` targets `main` as draft/no-merge. Review PR1 → PR2 → PR3; accumulate PR3 → PR2 → PR1 → tracker → `main`. Retarget/rebase polluted child diffs; rollback PR3 then PR2, retaining PR1 recognition.

| Unit | Branch → target | Scope |
|---|---|---|
| PR1 | `feat/kan-230-redmine-comment-pr1-marker-recognition` → tracker | Inert marker recognition, target 260 lines. |
| PR2 | `feat/kan-230-redmine-comment-pr2-dispatch` → PR1 | Inert gated dispatch, target 390 lines. |
| PR3 | `feat/kan-230-redmine-comment-pr3-capture` → PR2 | Capture/activation, target 390 lines. |

## PR1 — marker recognition

- [x] 1.1 **RED:** Create `packages/api/src/modules/integrations/providers/redmine/comment-marker.test.ts` for canonical final UUID, stripped body, malformed/multiple/reserved markers and copied/spoofed markers.
- [x] 1.2 **GREEN:** Create `packages/api/src/modules/integrations/providers/redmine/comment-marker.ts`; update `packages/api/src/modules/integrations/inbound.ts` and `packages/api/src/modules/integrations/inbound.test.ts` to recognize only binding/parent/UUID/work-valid echoes; reject spoofed journals.
- [x] 1.3 **REFACTOR/verify:** Keep no capture/dispatch path; run `pnpm --dir packages/api run test:types` and `pnpm --dir packages/api run test`.

## PR2 — proof and dark dispatch

- [x] 2.1 **Gate before code (JD2-003):** Identify production config/app-wiring and pre-claim gates for normal **and ambiguous** comment claims. If no safe ≤399-line seam exists, stop and re-slice/amend/re-review.
- [x] 2.2 **RED:** Extend `packages/api/src/modules/integrations/core/types.ts`, `packages/api/src/modules/integrations/providers/redmine/adapter.test.ts`, and `packages/api/src/modules/integrations/providers/redmine/http.test.ts` for complete parent+exact-marker+stripped-hash+actor proof and one blind write.
- [x] 2.3 **GREEN:** Add `RedmineHttpClient.putOnce()` in `packages/api/src/modules/integrations/providers/redmine/http-client.ts`; update `packages/api/src/modules/integrations/providers/redmine/adapter.ts`, `packages/api/src/modules/integrations/worker.ts`, and `packages/api/src/modules/integrations/retry.test.ts` for proved/unproved reconciliation, conflict, and zero I/O on failed fences.
- [x] 2.4 **REFACTOR/verify:** Wire `commentDispatchEnabled=false` before leasing; prove unrelated work continues and no local capture exists. Run `pnpm --dir packages/api run test:types`, `pnpm --dir packages/api run test`, and `pnpm --dir packages/api run build`.

## PR3 — atomic capture

- [x] 3.1 **Gate before code (JD-003):** Validate mutation lock order against `connection → binding → work`; inversion stops apply for design amendment/re-review.
- [x] 3.2 **Gate before code (JD2-002):** Confirm `IntegrationSyncWork.refId` semantics. If it cannot store the parent issue ref, stop for design amendment/re-review.
- [ ] 3.3 **RED:** Add eligible/inactive-link cases in `packages/api/src/modules/comment/__tests__/service.test.ts`, ownership cases in `packages/api/src/modules/integrations/outbox.int.test.ts`, and both race orders in `packages/api/src/modules/integrations/inbound.test.ts`.
- [ ] 3.4 **GREEN:** Update `packages/api/src/modules/comment/service.ts`, `packages/api/src/modules/integrations/outbox.ts`, `packages/api/src/modules/integrations/inbound.ts`, and `packages/api/src/modules/integrations/worker.ts` for atomic comment/activity/work capture, parent issue lane, and convergent echo attachment.
- [ ] 3.5 **REFACTOR/verify:** Add `commentCaptureEnabled=false`; verify capture-then-dispatch rollout, PR3 rollback, JD-001 proof, `pnpm --dir packages/api run test:types`, `pnpm --dir packages/api run test`, and `pnpm --dir packages/api run build`.

## Completion

- [ ] Each PR includes its tests, stays ≤399 changed product/test lines, and preserves JD-001/JD-002; JD-004 is informational only.

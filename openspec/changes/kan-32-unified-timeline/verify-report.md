# Verify Report: KAN-32 — Unified Issue Timeline

**Date**: 2026-06-09
**Verdict**: PASS WITH WARNINGS
**Mode**: Strict TDD
**Branch**: feat/kan-32-unified-timeline

---

## Build / Test / Typecheck Evidence

| Suite | Files | Tests | Result |
|---|---|---|---|
| Web (`pnpm --filter @kanon/web test`) | 83 passed, 1 skipped (84) | 570 passed, 5 todo (575) | GREEN |
| API (`cd packages/api && pnpm vitest run`) | 14 failed, 59 passed (73) | 76 failed, 970 passed, 2 skipped (1048) | RED (pre-existing) |
| Web TypeCheck (`tsc --noEmit`) | — | — | CLEAN (exit 0) |

**API failures are pre-existing on `main`**: confirmed by stash + rerun. The same 76 tests fail identically on the base branch. Affected suites: `issue-subscription`, `notification/s5-preferences`, `issue-dependency`, `via-threading`, `dashboard/mentions-isolation`. None of these are owned by KAN-32.

---

## Task Completion Matrix

| Task | Status |
|---|---|
| A1 RED — API serializer via test | COMPLETE |
| A2 GREEN — `via` on RawActivityLog + SerializedActivityLog + return | COMPLETE |
| A3 — `via` on web Comment + ActivityLog types | COMPLETE |
| B1 — `timeline-types.ts` with TimelineItem union (8 kinds) | COMPLETE |
| B2 RED — `use-unified-timeline.test.ts` (18 tests) | COMPLETE |
| B3 GREEN — `mergeTimeline` + `useUnifiedTimeline` | COMPLETE |
| C1 RED — `via-badge.test.tsx` (7 tests) | COMPLETE |
| C2 GREEN — `via-badge.tsx` | COMPLETE |
| D1 RED — `unified-timeline.test.tsx` (3 tests) | COMPLETE |
| D2 GREEN — `unified-timeline.tsx` | COMPLETE |
| E1 — `issue.tsx` tab collapse → single Timeline tab | COMPLETE |
| E2 — mutation invalidates both caches | COMPLETE (verified by source inspection) |
| E3 — `comment-list.tsx` deleted | COMPLETE (confirmed absent) |
| E4 — `tabs-section.tsx` deleted | COMPLETE (confirmed absent) |
| E5 — single composer N/A | COMPLETE (CommentList deleted; single composer in issue.tsx bottom bar) |
| F1 — full suites green | COMPLETE (web green; API failures pre-existing) |
| F2 — typecheck clean | COMPLETE |
| F3 — non-goals scope check | COMPLETE |

All 16 tasks are checked. No unchecked implementation tasks.

---

## Spec Compliance Matrix

| Scenario | Requirement | Covering Test | Result |
|---|---|---|---|
| S1 — interleaved feed ASC | REQ-TL-01, REQ-TL-02 | `use-unified-timeline.test.ts` > "returns items sorted oldest-first across both sources" | PASS |
| S2 — via=claude-code badge | REQ-VB-01, REQ-VB-02 | `via-badge.test.tsx` > "renders 'Claude Code' label when via='claude-code'" | PASS |
| S3 — cursor/antigravity/cli badges | REQ-VB-02 | `via-badge.test.tsx` (3 tests via it.each) | PASS |
| S4 — via=web → no badge | REQ-VB-04 | `via-badge.test.tsx` > "renders nothing when via='web'" | PASS |
| S5 — via=null → no badge | REQ-VB-05 | `via-badge.test.tsx` > "renders nothing when via=null" | PASS |
| S6 — composer invalidates both caches | REQ-CM-03 | Source inspection: `useAddCommentMutation.onSuccess` invalidates `commentKeys.list(issueKey)` AND `activityKeys.list(issueKey)` — no dedicated runtime test | WARNING (no automated coverage) |
| S7 — empty timeline state | REQ-TL-01 | `unified-timeline.test.tsx` > "renders empty state when no items" | PASS |
| S8 — loading state | REQ-TL-05 | `unified-timeline.test.tsx` > "renders loading state" | PASS |
| S9 — stable tiebreak equal createdAt | REQ-TL-03 | `use-unified-timeline.test.ts` > "sorts by id ASC (localeCompare) when createdAt values are equal" | PASS |
| S10 — serializer via="cli" | REQ-API-01, REQ-API-02 | `serializer.test.ts` > "Scenario 10: passes through via='cli' from raw log" | PASS |
| S11 — serializer via=null | REQ-API-02 | `serializer.test.ts` > "Scenario 11: passes through via=null for pre-provenance rows" | PASS |
| S12 — single composer | REQ-CM-01, REQ-CM-02 | Source inspection: single `<textarea>` composer in `issue.tsx` bottom bar; `comment-list.tsx` deleted — no dedicated runtime test | WARNING (no automated coverage) |
| S13 — TS kind narrowing | REQ-TI-03 | `tsc --noEmit` CLEAN — `satisfies TimelineItem` on every kind in `use-unified-timeline.ts` ensures exhaustiveness at compile time | PASS (compile-time coverage, appropriate) |
| S14 — unknown via → no badge | REQ-VB-06 | `via-badge.test.tsx` > "renders nothing for an unrecognized via value" | PASS |

---

## Design Corrections Verification

| Correction | Requirement | Status |
|---|---|---|
| (1) No `sync` kind | union must NOT include `sync` | PASS — `timeline-types.ts` has 8 kinds (human-comment, agent-comment, state-change, created, assigned, field-change, deleted, document-added). No `sync`. |
| (2) `mergeTimeline` drops `action==="commented"` rows | no duplicate feed items | PASS — `use-unified-timeline.ts:61` `.filter((log) => log.action !== "commented")`. Covered by dedicated test "filters out action=commented from activity stream". |
| (3) Union kinds aligned to real actions | state_changed→state-change, edited→field-change, delete→deleted, document_added→document-added | PASS — `mapActivityToItem` switch covers all 6 real actions + unknown fallback. All tested individually. |
| (4) Tiebreak: `id.localeCompare` | `a.id.localeCompare(b.id)` | PASS — `use-unified-timeline.ts:67`. Covered by S9 test. |
| (5) AI sources: `{mcp, engram_sync, system, adr}` | exactly these 4 | PASS — `AGENT_SOURCES = new Set(["mcp", "engram_sync", "system", "adr"])` in `use-unified-timeline.ts:27`. Each tested via `it.each`. |

---

## ViaBadge Rules Verification

| Rule | Status |
|---|---|
| claude-code/cursor/antigravity/cli → shows badge | PASS — `VIA_LABELS` map contains all 4 keys |
| web → renders null | PASS — explicit `via === "web"` check in guard clause |
| null → renders null | PASS — explicit `via === null` check in guard clause |
| unknown value → renders null | PASS — `!(via in VIA_LABELS)` guard catches all unlisted values |
| cobalt color `oklch(0.52 0.11 245)` | PASS — inline style `color: "oklch(0.52 0.11 245)"` |
| `Icon.Spark` from `@/components/ui/icons` | PASS — `import { Icon } from "@/components/ui/icons"` + `<Icon.Spark />` |

---

## Non-Goals Verification

| Non-Goal | Status |
|---|---|
| AgentThread untouched | PASS — `agent-thread.tsx` exists unchanged; `git diff --stat main...HEAD` shows it NOT in the diff |
| No SSE / WebSocket subscription | PASS — no SSE in changed files; `git diff` shows no SSE-related additions |
| No `/timeline` API endpoint | PASS — no new route file; `git diff` shows only serializer.ts modified in API |
| No database migration | PASS — no migration files in diff |
| Comment edit/delete behavior unchanged | PASS — `comment-list.tsx` deleted (was unused); comment mutations in `use-issue-mutations.ts` unchanged |
| No pagination added | PASS — no pagination parameters in any changed file |

---

## Issues

### WARNINGS

**W1 — Scenario 6 (composer cache invalidation) has no automated runtime test**
- Requirement: REQ-CM-03
- Current state: Source inspection confirms `useAddCommentMutation.onSuccess` correctly invalidates both `commentKeys.list(issueKey)` and `activityKeys.list(issueKey)`. The behavior is correct.
- Gap: `use-issue-mutations.test.tsx` contains only `it.todo` stubs for the F4 estimate-gate tests; there is no passing test for the comment mutation's dual-cache invalidation.
- Risk: A future refactor could break the activity cache invalidation without a test catching it.
- Recommendation: Add a test in `use-issue-mutations.test.tsx` that mocks `queryClient.invalidateQueries` and asserts both cache keys are invalidated on comment post success.

**W2 — Scenario 12 (single composer) has no automated runtime test**
- Requirement: REQ-CM-01, REQ-CM-02
- Current state: `CommentList` was deleted (confirmed absent on disk). The single `<textarea>` composer in `issue.tsx` is the only composer in the component tree.
- Gap: Task E5 is marked N/A with CommentList deleted, but no integration/component test asserts `queryAllByRole("textbox")` count = 1 (excluding description textarea) in the rendered issue page.
- Risk: Low — structure is unambiguous. But the guarantee is manual, not automated.
- Recommendation: Add a smoke test in `issue-detail-pane.test.tsx` or a new file that renders the timeline tab and asserts a single comment composer exists.

### SUGGESTIONS

**S1 — `RawActivityLog.via` typed as `via?: string | null` (optional) vs `SerializedActivityLog.via` as `via: string | null` (required)**
- The optional `?` on `RawActivityLog.via` is intentional (pre-KAN-32 rows may not have the field at the type level), and the `?? null` coercion in `serializeActivityLog` handles it correctly.
- No action required — this is a deliberate type boundary. Just documenting it for clarity.

**S2 — Spec REQ-TI-02 lists `sync` and `generic-field-change` kinds; implementation has `field-change` and no `sync`**
- This is INTENTIONAL per design.md corrections 1 & 3, which are authoritative over the spec.
- No action required. The spec should be considered superseded by the design on this point.

---

## Correctness Spot-Checks

| Check | Result |
|---|---|
| `mergeTimeline` unknown action → `field-change` fallback (not dropped) | PASS — `default:` branch in `mapActivityToItem` returns `field-change` |
| `via` carried through on both comment and activity items | PASS — tested in `mergeTimeline — via passthrough` describe block |
| `useUnifiedTimeline` composes existing queries, no new fetch | PASS — calls `useCommentsQuery` + `useActivityQuery` only |
| `isLoading` = comments OR activity loading | PASS — `commentsLoading \|\| activityLoading` |
| `isError` = comments OR activity error | PASS — `commentsError \|\| activityError` |
| Single `Tab` type includes `"timeline"` as default | PASS — `useState<Tab>("timeline")` default |

---

## Final Verdict

**PASS WITH WARNINGS**

Implementation is complete and correct. All 16 tasks are checked. 12 of 14 scenarios have passing runtime tests. 2 scenarios (S6, S12) are covered by source inspection but lack automated test assertions — these are WARNING-level gaps, not blockers. All design corrections are honored. All non-goals are respected. TypeScript compiles clean. Web test suite is fully green (570/570). API failures are pre-existing on `main` and unrelated to KAN-32.

**Archive readiness**: ready for `sdd-archive`. Recommend adding the two missing test cases before or alongside archiving, but they do not block the archive step.

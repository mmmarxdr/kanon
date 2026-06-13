# Tech-Debt Review — `packages/api` + `packages/web`

**Date:** 2026-06-03
**Method:** Bounded multi-agent workflow — 6 reviewers fan out by dimension, every finding adversarially verified against the actual code (claims refuted or severity-downgraded where exaggerated), 2 synthesis passes.
**Scale:** 72 agents, ~2.7M tokens. 54 findings survived verification (26 api / 28 web).

> The verification pass mattered: it **refuted** the two scariest framing claims — "migrate to NestJS" and "3-5 month React refactor" — and caught fabricated metrics in the raw reviews (e.g. "no unit tests" was false; 11 `service.test.ts` files exist with mocked Prisma). Treat the verdicts below as evidence-backed, not first-pass impressions.

---

## TL;DR

| Package | State | Framework verdict |
|---------|-------|-------------------|
| `api` (Fastify + Prisma) | Healthier than its god-files suggest. Clean `routes → services → Prisma` layering, centralized `AppError`, Zod validation, typed event bus. Real debt is **narrow and cheap**: observability gaps + one consistency hole. | **DO NOT migrate to NestJS.** Cost underestimated ~9× (test suite 16.3k LOC, Fastify-specific `app.inject` harness). Zero functional gain — Fastify already does modules/DI/validation/guards. |
| `web` (React + TanStack Query) | **Healthy**, not debt-laden. Page components large but modular (memo'd, prop-driven, hooks extracted). TanStack layer strong (granular keys, robust invalidation, optimistic updates + rollback). | **Incremental fixes, NOT a big refactor.** One real re-render bug (timeline). Everything else is hygiene or surgical extraction. |

Your instinct that "routes contain controllers with Prisma calls" → **partly right, but it's services not routes that call Prisma**, and the layering is actually clean. The god-files are real (`issue/service.ts` 992, `auth/service.ts` 775, `cycle/service.ts` 752, `cycles-view.tsx` 1309, `gantt-timeline.tsx` 911) but only `auth/service.ts` has a genuine SRP violation worth splitting now.

---

## API — verdict

> packages/api is a well-structured, production-hardened Fastify + Prisma codebase, healthier than a surface read of its god-files suggests. Intentional simplicity choices (no repository layer, direct Prisma, functional services) are appropriate at ~12K-LOC / sub-1200-line-per-service scale. The real confirmed debt: (1) event bus swallows subscriber errors with ZERO logging; (2) one post-mutation call is unguarded, allowing an issue with no activity log; (3) auth service genuinely tangles crypto + user lifecycle + email + reset; (4) response-schema validation covers only 3 of 15 modules; (5) Prisma constraint errors propagate as bare 500s. None are runtime crises.

### NestJS migration — DO NOT

Verification showed cost underestimated ~9×: test suite **16,351 lines** (not ~1.8k) built on Fastify `app.inject()` + custom decorators requiring full rewrites; service code 5,261 lines; middleware uses `preHandlerHookHandler` types incompatible with NestJS guards. **8-12 weeks of pure rewrite, high regression risk, zero functional gain** — Fastify already implements every pattern NestJS provides (plugin module composition, Zod validation, DI via decoration + typed augmentation, domain event bus, guard-equivalent role middleware).

Even the cheaper "add DI container + repository layer" alternative is **not yet warranted** — its own trigger thresholds (>1200 lines/service or >4 sibling imports) aren't met. The one piece with real teeth — mapping Prisma errors to `AppError` — needs **no** repository abstraction.

### API priorities (impact/effort ordered)

| # | Effort | Fix |
|---|--------|-----|
| 1 | S | **Instrument event bus** — `in-process.ts:41-45` bare try/catch discards subscriber exceptions with zero logging; SSE clients silently lose events. Best ROI in the report. Add structured logging in catch + slow-emit (>100ms) warning. |
| 2 | S | **Guard `createActivityLog`** at `issue/service.ts:138` with try/catch like its siblings (`recordCycleScopeEvent`, `eventBus.emit`, `parseAndUpsertMentions` are all wrapped; this one isn't). After a non-transactional `issue.create()`, a throw leaves an issue with no activity log. One-line fix. |
| 3 | M | **Decompose auth service** (775 lines) → `auth-token` / `auth-password` / `auth-email` / `auth-password-reset` / `auth-user`. Genuine SRP violation; unlocks unit-test isolation for 10+ functions (crypto already isolates cleanly at lines 24-114; `emailProvider` already injected). |
| 4 | M | **Close response-schema gap** — only 3 of 15 modules declare response schemas. Request validation is solid; response validation isn't the comprehensive contract it's presented as. |
| 5 | M | **Normalize Prisma constraint errors** to `AppError`. Only `delete-cycle.ts` catches (P2025→404); every other FK/unique/check violation propagates as bare 500. Add catch blocks or a Prisma-error mapper in `error-handler` plugin. No repository needed. |
| 6 | S | **Document implicit conventions** — throw-vs-return, HTTP status semantics (409 vs 422), Zod-shape vs service-domain validation split. Retires several "implicit convention" findings at once. |

### API — full findings

**Architecture & separation**
- `[HIGH/S]` Event bus in-process, fire-and-forget pervasive — `event-bus/in-process.ts`, `issue/service.ts:161`, `cycle/delete-cycle.ts:172`. Document best-effort guarantees; add >100ms warning subscriber.
- `[MED/M]` No data-access / repository layer — services call Prisma directly (180+ calls). Acceptable at scale; extract read-heavy queries only if test friction rises.
- `[MED/M]` Transaction handling selective but sound — `issue.create()` not transactional, `createActivityLog` unguarded (the priority-2 bug).
- `[MED/M]` Error handling consistent but implicit — add `AppError.notFound()` factory; define throw-vs-propagate convention.
- `[MED/S]` Schema validation split routes↔services — Zod = HTTP shape (400), services = domain (422). Document in `validation.md`.
- `[LOW/S]` DI via Fastify decoration — add `services/index.ts` barrel; consider factory exports for mockability.
- `[LOW/L]` Limited mocking surface — optionally accept Prisma client param for unit isolation.
- `[LOW/S]` Email provider injected per-route not singleton — decorate on instance for consistency.

**God-file decomposition**
- `[HIGH/M]` **auth/service.ts** (776) — 4 tangled responsibilities → split as above (token-crypto/password/email/reset/user + orchestrator).
- `[MED/L]` **issue/service.ts** (993) — 5 responsibilities → `issue-crud` / `issue-state-machine` / `issue-activity` / `issue-context`.
- `[MED/M]` **require-role.ts** (497) — 6 duplicate factories → generic `makeResourceRoleFactory(type, param)` + shared `findResourceWithProject` helper. ~50% reduction.
- `[MED/M]` Implicit cross-service coupling (event-bus + activity log) — consider `auditMutation(fn, action)` HOF / post-mutation handler.
- `[LOW/M]` **cycle/service.ts** (753) — 4 responsibilities → `cycle-crud` / `cycle-burnup` / `cycle-risk` / `cycle-scope` / `cycle-queries`.

**NestJS assessment** (all = reasons NOT to migrate)
- Zod + type provider superior to class-validator here — keep.
- Fastify hooks extensible, no migration benefit.
- Repository layer absent = low-priority enhancement, decoupled from framework choice.
- Migration cost/risk not worth ROI.
- Cheaper path: lightweight DI + repos on 3-4 services ONLY past 1200-line / 4-import thresholds (not met).
- Fastify plugins already provide module architecture, mature auth/authz, event bus, error lifecycle, isolated config, explicit plugin deps.

---

## WEB — verdict

> packages/web is a HEALTHY React + TanStack Query codebase. Of ~30 raw findings, verification downgraded the large majority; only TWO survive as genuine "high", both localized in the timeline. The "god-components need 3-5 month refactor" framing was inflated — page components are large but modular by React standards (memo'd, prop-driven, hooks isolated in cycles AND issue-detail).

**Is React misused causing re-renders?** In exactly ONE place yes, broadly no. The real bug: `gantt-timeline.tsx` `GroupHeader` (line 564) and `ItemRow` (line 642) are unmemoized functions in `RowsLayer`'s loop, AND their callback props (`setSelectedItemId`/`setHoveredItemId`) are raw setters not `useCallback`-wrapped. On hover with many roadmap items, every row re-renders. **Fix requires `React.memo` AND `useCallback` together — memo alone does nothing.** Elsewhere, re-render concerns are premature (memoizing `doneCycles` "wouldn't help the memo'd component"; cycles-view memo usage is "professional optimization, not tech debt").

**TanStack Query** is strong: granular query-key factories, comprehensive invalidation, optimistic updates with rollback. Flagged issues are latent (unstable roadmap filter key — filters currently dead/client-side) or bounded (broad SSE `*.all` invalidations — real but observer pattern bounds fan-out to mounted views; proper fix needs backend payload IDs).

### Web priorities

| # | Effort | Fix |
|---|--------|-----|
| 1 | M | **Timeline re-render bug** — `React.memo` on `GroupHeader`+`ItemRow` AND `useCallback` on `onItemClick`/`onHoverChange` in `gantt-timeline.tsx`, *together*. Only measurable perf win in the report. |
| 2 | M | **Replace imperative hover** `e.currentTarget.style.background = ...` with CSS `:hover` — `group-card.tsx:64`, `issue-card.tsx:55`, `app-sidebar.tsx:227,357`. Bypasses React, breaks transitions. Correctness, not perf. |
| 3 | S | **Hygiene sweep** — delete dead `SearchChip` (`primitives.tsx:481-579`); dedupe `AGENT_SOURCES` (4×); move `STATE_MAP`/`PRIO_ORDER`/`TYPE_MAP` to shared `constants.ts`. Highest ROI/effort. |
| 4 | M | **Surgical cycles-view extraction** — `useBurnupGeometry` hook for SVG geometry (517-551) + `cycles-view.utils.ts` for `stateColor`/`prioColor`/`groupByState`/`fmtDate`. STOP there; no container/presentational rewrite. |
| 5 | S | **Conditional board groups fetch** — `board.tsx:37` calls `useGroupsQuery` unconditionally; gate with `enabled` or prefetch on toggle. |
| 6 | L | **Track (don't fix yet) SSE invalidation scoping** — `*.all` keys too broad; proper fix needs backend SSE payloads enriched with entity IDs. Defer until backend change lands. |

### Web — full findings

**Architecture / god-components**
- `[MED/XL]` cycles-view.tsx (1310) monolith → container/presentational + utils + `useBurnupGeometry`. (Priority 4 is the defensible *slice*; the XL rewrite was downgraded.)
- `[MED/M]` gantt-timeline.tsx state mgmt → `useTimelineGrouping` / `useTimelineHover`; map-render `RowsLayer` with stable keys.
- `[MED/S]` primitives.tsx (671) → split by category (avatars/indicators/tags/inputs/charts) + `constants.ts`.
- `[MED/S]` issue.tsx `RightPaneContent` test helper duplicates logic → `issue-detail.rules.ts` pure functions.
- `[MED/M]` gantt geometry coupled to render → `useTimelineGeometry` + `GeometryContext`.
- `[MED/M]` issue.tsx description editing scattered across 3 effects → `useEditableTextField` + `DescriptionEditor`/`CommentComposer`.
- `[LOW/M]` Inconsistent hook extraction — *partly refuted* (cycles + issue-detail already extract); add lint rule for >3 query hooks/page.
- `[LOW/S]` cycles-view memo wrappers — profile before adding/removing; "professional patterns" per verifier.
- `[LOW/S]` gantt missing error boundary / edge-data validation.

**React performance**
- `[HIGH/M]` GroupHeader+ItemRow unmemoized in timeline (priority 1).
- `[HIGH/M]` Inline style mutation in card hover handlers (priority 2).
- `[MED/M]` app-sidebar inline arrow handlers cause child re-renders (`227-234`, `357-364`).
- `[MED/M]` command-palette unnecessary `useMemo` on stable data (`42-51`); split into two memos.
- `[MED/M]` Inline style objects in gantt hot paths (`232`, `269`, `356`) → module consts / memoized factory.
- `[LOW/S]` Missing `React.memo` on GroupCard/IssueCard list items.
- `[LOW/S]` Tooltip inline handlers in app-sidebar — stabilize if Tooltip memoizes.
- `[LOW/S]` `doneCycles` derived on every render (`cycles-view:80`) → `useMemo([cycles])`.
- `[LOW/S]` Drag overlay new boxShadow object (`grouped-board:377`) → module const.
- `[LOW/M]` ItemRow hover handler inline (`timeline-bar:125`) → `useCallback`.
- `[LOW/M]` RowsLayer imperative array build (`gantt:506-552`) → memoize / map + memo.

**TanStack Query**
- `[MED/M]` `useRoadmapQuery` filters not in cache key (`use-roadmap-query:19`) → `roadmapKeys.list(projectKey, filters)`. (Latent — filters currently client-side.)
- `[MED/L]` Broad SSE `*.all` invalidations (priority 6) — needs backend entity IDs.
- `[MED/S]` Roadmap snapshot mutation missing type safety (`94-112`) → type guards + rollback warn.
- `[MED/S]` Missing prefetch on board view-mode switch (`board:37`) → `prefetchQuery` in toggle.
- `[LOW/S]` Cycle context param key stability (`use-cycle-mutations:121`) → literal type for `'all'`.
- `[LOW/M]` Inconsistent mutation error handling (toast vs inline) → pick one convention.
- `[LOW/M]` Optimistic update w/o detail-cache consistency check → assert on undefined snapshot.
- `[LOW/M]` Proposal context system maintenance burden → simplify invalidation or `setQueryData` both caches.

---

## Suggested execution order

**API quick win sprint (1-2 days):** priorities 1, 2, 6 — all S-effort, retire observability + consistency + convention debt.
**API focused refactor (when touched):** priority 3 (auth split), then 4 + 5.
**Web focused sprint:** priorities 1, 2, 3 together; fold 4 in next time cycles-view is touched; gate 6 on backend SSE work.

**Do NOT:** migrate to NestJS, or do a ground-up React container/presentational rewrite. Both burn months to "fix" code the verifiers repeatedly called sound.

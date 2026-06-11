# ADR 0006 — Mutation Testing Methodology (StrykerJS)

**Status**: Accepted

## Context

Line coverage measures which lines *executed* during a test run. It does not
measure whether a test would *catch a regression* on those lines. A test can
execute a line without asserting anything about its behaviour — yielding high
coverage with low real protection.

Concrete example from this codebase: `src/modules/events/workspace-events.ts`
(the workspace SSE endpoint hardened by KAN-76) had passing tests at 16.94%
line coverage. The tests exercised only the auth preHandler (403/401); the
entire streaming surface — `Last-Event-ID` replay, the `event.workspaceId ===
wid` filter, the heartbeat, disconnect cleanup — was never asserted.

Mutation testing closes this gap. [StrykerJS](https://stryker-mutator.io)
injects faults ("mutants") into the source — flipping `===` to `!==`, deleting
a statement, negating a boolean — and re-runs the tests. A mutant the tests
still pass against **survived**: the tests are theatre on that line. The
**mutation score** (% of mutants killed) is a far stronger signal than line
coverage.

Compatibility verified at adoption: Stryker 9.6.1 (`@stryker-mutator/core` +
`@stryker-mutator/vitest-runner`) requires `vitest >=2.0.0` (we run 2.1.9) and
`node >=20` (we run 26).

## Decision

Mutation testing is adopted as a **per-module, scoped, local/manual quality
gate**, run while writing or hardening that module's tests — **not** as a
per-PR CI gate.

Rationale: Stryker re-runs the relevant tests once *per mutant*. The `@kanon/api`
suite is ~1129 tests running against a real Postgres with `singleFork: true`
(no parallelism), ~70s per full run. A whole-suite mutation run would be
intractable as a per-PR gate (hours, no parallelism). Scoping is therefore not
optional — it is the mechanism that makes the technique usable.

Mechanics:

- `stryker.config.mjs` scopes mutation via `mutate` to one module at a time.
  The pilot scope is `src/modules/events/workspace-events.ts` (KAN-84 slice 1).
- The Stryker vitest runner uses `vitest.mutation.config.ts`, a focused config
  whose `include` glob admits only the tests for the module(s) under mutation,
  keeping each run fast.
- `plugins: ["@stryker-mutator/vitest-runner"]` is declared explicitly because
  pnpm's non-flat `node_modules` breaks Stryker's default `@stryker-mutator/*`
  glob auto-discovery.
- `incremental: true` re-evaluates only mutants affected by changes between
  runs.
- Run via `pnpm --filter @kanon/api test:mutation`.

The technique favours fast, isolated **unit** tests: DB-bound integration tests
are poor mutation targets (slow, flaky under the per-mutant re-run loop).
Making a module mutation-testable therefore pushes its pure logic out of the
HTTP/DB layer into unit-testable functions — which is the same refactoring
KAN-84 calls for ("apply any refactors uncovered during test-writing").

## Consequences

- Mutation score is widened **one module at a time** as that module's tests are
  hardened; `mutate` grows incrementally. There is no big-bang full-suite run.
- A scheduled (nightly/weekly) rotating full or partial mutation run may be
  added later for global visibility, kept off the per-PR path.
- Stryker artifacts (`.stryker-tmp/`, `reports/mutation/`,
  `reports/stryker-incremental.json`) are git-ignored.
- New modules and refactors should be designed with unit-testable seams so they
  can be brought under mutation cheaply.

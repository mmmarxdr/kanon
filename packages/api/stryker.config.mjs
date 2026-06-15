// @ts-check
/**
 * StrykerJS mutation testing config (KAN-87).
 *
 * Methodology: mutation testing runs PER MODULE, scoped via `mutate`, as a
 * local/manual quality gate while writing that module's tests — NOT as a
 * per-PR CI gate. Stryker re-runs the relevant tests once per mutant; the API
 * suite (~1129 tests against a real Postgres, singleFork) makes a whole-suite
 * per-PR run intractable. Widen `mutate` one module at a time as tests harden.
 *
 * The runner uses `vitest.mutation.config.ts`, which includes only the tests
 * for the module(s) under mutation so runs stay fast.
 *
 * @type {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
export default {
  packageManager: "pnpm",
  testRunner: "vitest",
  // pnpm's non-flat node_modules breaks Stryker's default `@stryker-mutator/*`
  // glob auto-discovery, so name the runner plugin explicitly (resolved by require).
  plugins: ["@stryker-mutator/vitest-runner"],
  vitest: {
    configFile: "vitest.mutation.config.ts",
  },
  // KAN-84 slice 1: SSE/eventing surface (KAN-76 hardened).
  // KAN-84 slice 3: roadmap-sync pure logic (computeStatus + syncRoadmapItemStatus).
  // KAN-102: forecast engine pure logic (topo + forward/backward pass + forecastEnd).
  // KAN-115: forecast listener (debounce + event→projectId resolution + cache),
  //   unit-tested with mocked bus/prisma — a valid mutation target.
  // Note: service.ts is DB-orchestration whose only tests are DB integration tests,
  //   which don't execute under Stryker's dry-run — line coverage is the bar there,
  //   not mutation. Extract its pure decision logic to make it mutation-testable (KAN-113).
  mutate: [
    "src/modules/events/workspace-events.ts",
    "src/modules/roadmap/roadmap-sync.ts",
    "src/modules/forecast/engine.ts",
    "src/modules/forecast/listener.ts",
    // KAN-113: pure decision rules extracted from service.ts (mutation-testable)
    "src/modules/forecast/rules.ts",
  ],
  reporters: ["html", "clear-text", "progress"],
  // Re-evaluate only mutants affected by changes between runs.
  incremental: true,
  thresholds: {
    high: 80,
    low: 60,
    break: null,
  },
};

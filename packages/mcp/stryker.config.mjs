// @ts-check
/**
 * StrykerJS mutation testing config for @kanon/mcp (KAN-104).
 *
 * Methodology (mirrors packages/api): mutation testing runs PER MODULE, scoped
 * via `mutate`, as a local/manual quality gate while hardening that module's
 * tests — NOT a per-PR CI gate. The runner uses `vitest.mutation.config.ts`,
 * which includes only the tests for the module(s) under mutation. Widen
 * `mutate` one tool file at a time as tests harden.
 *
 * @type {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
export default {
  packageManager: "pnpm",
  testRunner: "vitest",
  // pnpm's non-flat node_modules breaks Stryker's default plugin glob, so name
  // the runner plugin explicitly (resolved by require).
  plugins: ["@stryker-mutator/vitest-runner"],
  vitest: {
    configFile: "vitest.mutation.config.ts",
  },
  // KAN-104: capture tools (report_incident + estimate propose/apply).
  mutate: ["src/tools/capture.ts"],
  reporters: ["html", "clear-text", "progress"],
  incremental: true,
  thresholds: {
    high: 80,
    low: 60,
    break: null,
  },
};

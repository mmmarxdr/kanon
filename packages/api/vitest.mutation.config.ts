import { defineConfig } from "vitest/config";

/**
 * Focused vitest config for Stryker mutation runs (KAN-87).
 *
 * Includes ONLY the module(s) currently under mutation so each Stryker run
 * stays fast and isolated from the full DB-bound integration suite. Stryker
 * re-runs these tests once per mutant, so the include glob here is the lever
 * that keeps mutation testing a per-module quality gate rather than an
 * intractable whole-suite job.
 *
 * No coverage thresholds: Stryker does its own instrumentation and the
 * vitest coverage gate would only get in the way.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: [
      "src/modules/events/**/*.test.ts",
      "src/modules/roadmap/**/*.test.ts",
      "src/modules/forecast/**/*.test.ts",
    ],
    setupFiles: ["src/test/setup.ts"],
    testTimeout: 15000,
    hookTimeout: 30000,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});

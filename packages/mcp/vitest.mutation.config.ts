import { defineConfig } from "vitest/config";

/**
 * Focused vitest config for Stryker mutation runs (KAN-104).
 *
 * Includes ONLY the module(s) currently under mutation so each Stryker run
 * stays fast — Stryker re-runs these tests once per mutant. Widen the include
 * glob one module at a time as more tools get mutation-hardened.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/tools/capture.test.ts"],
  },
});

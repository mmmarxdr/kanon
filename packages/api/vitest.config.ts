import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "prisma/**/*.test.ts"],
    setupFiles: ["src/test/setup.ts"],
    testTimeout: 15000,
    hookTimeout: 30000,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/test/**",
        "src/index.ts",
        "src/**/types.ts",
        "src/**/interface.ts",
        // KAN-193: incomplete / opt-in triage surfaces — keep out of the global
        // ratchet until enablement tasks land real request-path coverage.
        "src/modules/triage/performance/**",
        "src/modules/triage/index.ts",
        "src/modules/triage/issue-history.ts",
        "src/modules/triage/routes.ts",
      ],
      // Ratchet: set ~1pt below the measured CI baseline (KAN-84 slice 4 raised
      // these after the roadmap + SSE coverage work). Measured global on a clean
      // CI DB: stmts 92.02 / branch 85.59 / funcs 93.62 / lines 92.02. The small
      // headroom absorbs run-to-run measurement noise; coverage can only go up.
      // The real quality net is mutation testing (test:mutation), run locally at
      // the end of each feature. Raise these as gaps close.
      // KAN-193: temporary branch floor 84 while triage enablement coverage lands
      // (post-land CI measured ~84.85 with incomplete surfaces excluded).
      thresholds: {
        statements: 91,
        branches: 84,
        functions: 93,
        lines: 91,
      },
    },
  },
});

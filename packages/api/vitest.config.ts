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
      ],
      // Ratchet: set ~1pt below the measured CI baseline (KAN-84 slice 4 raised
      // these after the roadmap + SSE coverage work). Measured global on a clean
      // CI DB: stmts 92.02 / branch 85.59 / funcs 93.62 / lines 92.02. The small
      // headroom absorbs run-to-run measurement noise; coverage can only go up.
      // The real quality net is mutation testing (test:mutation), run locally at
      // the end of each feature. Raise these as gaps close.
      thresholds: {
        statements: 91,
        branches: 85,
        functions: 93,
        lines: 91,
      },
    },
  },
});

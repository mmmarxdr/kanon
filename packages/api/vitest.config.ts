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
      // Ratchet: set just below the measured baseline (lines 88 / branch 84 /
      // funcs 90) so coverage can only go up. Raise these as gaps close.
      thresholds: {
        statements: 85,
        branches: 80,
        functions: 88,
        lines: 85,
      },
    },
  },
});

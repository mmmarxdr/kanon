import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Resolve @kanon/bridge directly from its src to avoid needing a dist
      // build during testing. The bridge src exports the same interface.
      "@kanon/bridge": path.resolve(__dirname, "../../packages/bridge/src/index.ts"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
    testTimeout: 10000,
    css: false,
  },
});

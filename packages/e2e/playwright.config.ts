import { defineConfig, devices } from "@playwright/test";
import { establishControlledE2eEnvironment } from "./e2e-environment.js";

const API_PORT = process.env["API_PORT"] ?? "3001";
const WEB_PORT = process.env["WEB_PORT"] ?? "5174";
// Validate the database before Playwright can start either web server.
const DATABASE_URL = establishControlledE2eEnvironment();

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  workers: 1,
  reporter: process.env["CI"] ? "github" : "html",
  timeout: 30_000,
  expect: { timeout: 5_000 },

  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  globalSetup: "./global-setup.ts",

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: [
    {
      command: `pnpm --filter @kanon/api dev`,
      url: `http://localhost:${API_PORT}/health`,
      env: {
        PORT: API_PORT,
        DATABASE_URL,
        JWT_SECRET: "e2e-test-jwt-secret",
        JWT_REFRESH_SECRET: "e2e-test-jwt-refresh-secret",
        NODE_ENV: "test",
        HOST: "0.0.0.0",
      },
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: `pnpm --filter @kanon/web dev --port ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}`,
      env: {
        API_URL: `http://localhost:${API_PORT}`,
      },
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});

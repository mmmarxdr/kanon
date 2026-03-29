import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load E2E-specific environment variables
dotenv.config({ path: path.resolve(__dirname, ".env.e2e") });

const API_PORT = process.env["API_PORT"] ?? "3001";
const WEB_PORT = process.env["WEB_PORT"] ?? "5174";
const DATABASE_URL =
  process.env["DATABASE_URL"] ??
  "postgresql://kanon:kanon@localhost:5432/kanon_e2e?schema=public";

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
      port: Number(API_PORT),
      env: {
        PORT: API_PORT,
        DATABASE_URL,
        JWT_SECRET: "e2e-test-jwt-secret",
        JWT_REFRESH_SECRET: "e2e-test-jwt-refresh-secret",
        NODE_ENV: "test",
        HOST: "0.0.0.0",
      },
      reuseExistingServer: !process.env["CI"],
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: `pnpm --filter @kanon/web dev --port ${WEB_PORT}`,
      port: Number(WEB_PORT),
      env: {
        API_URL: `http://localhost:${API_PORT}`,
      },
      reuseExistingServer: !process.env["CI"],
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});

import type { Page } from "@playwright/test";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load seed constants written by global-setup.ts
dotenv.config({ path: path.resolve(__dirname, "../.env.test") });

interface LoginOptions {
  email?: string;
  password?: string;
}

/**
 * Log in to Kanon via the UI login form.
 *
 * Navigates to /login, fills the email and password fields,
 * submits the form, and waits for navigation away from /login.
 *
 * Defaults to the seed user credentials written by global-setup.ts.
 */
export async function login(page: Page, opts?: LoginOptions): Promise<void> {
  const email = opts?.email ?? process.env["SEED_USER_EMAIL"] ?? "dev@kanon.io";
  const password =
    opts?.password ?? process.env["SEED_USER_PASSWORD"] ?? "Password1!";

  // Navigate to login page
  await page.goto("/login");
  await page.waitForSelector("#email", { timeout: 5_000 });

  // Fill form fields
  await page.fill("#email", email);
  await page.fill("#password", password);

  // Submit the form
  await page.click('button[type="submit"]');

  // Wait for navigation away from /login (successful login redirects to /workspaces)
  await page.waitForURL((url) => !url.pathname.includes("/login"), {
    timeout: 5_000,
  });
}

/**
 * Vitest global setup.
 * Sets test environment variables before any module loads.
 */

// Set test env vars BEFORE any module imports (env.ts validates at load time)
process.env["NODE_ENV"] = "test";
// Prefer an isolated DB for this stacked triage branch so shared kanon_test
// resets from other worktrees do not drop the additive ledger mid-suite.
process.env["DATABASE_URL"] =
  process.env["DATABASE_URL"] ??
  "postgresql://kanon:kanon@localhost:5432/kanon_test_pr9";
process.env["JWT_SECRET"] =
  process.env["JWT_SECRET"] ?? "test-jwt-secret-at-least-16-chars";
process.env["JWT_REFRESH_SECRET"] =
  process.env["JWT_REFRESH_SECRET"] ?? "test-jwt-refresh-secret-16-chars";
// COOKIE_SECRET is required by env.ts production-check (must be ≥32 chars
// in production). In test we provide a deterministic placeholder so
// buildApp()'s chain through prisma → env can resolve.
process.env["COOKIE_SECRET"] =
  process.env["COOKIE_SECRET"] ?? "test-cookie-secret-at-least-32-chars-long";
process.env["PORT"] = process.env["PORT"] ?? "3001";
process.env["TRIAGE_SEARCH_ENABLED"] = process.env["TRIAGE_SEARCH_ENABLED"] ?? "true";
process.env["TRIAGE_PREVIEW_ENABLED"] = process.env["TRIAGE_PREVIEW_ENABLED"] ?? "true";
process.env["TRIAGE_PROPOSAL_READS_ENABLED"] = process.env["TRIAGE_PROPOSAL_READS_ENABLED"] ?? "true";
process.env["TRIAGE_PROPOSALS_ENABLED"] = process.env["TRIAGE_PROPOSALS_ENABLED"] ?? "true";

// Vitest mirrors Vite's `import.meta.env.BASE_URL` into `process.env.BASE_URL`,
// defaulting to "/" — which pisses off `new URL(env.BASE_URL)` in service code
// (e.g. invite service builds the kanon:// link from BASE_URL host). Override
// to a valid absolute URL so the schema's default no-ops correctly.
if (!process.env["BASE_URL"] || process.env["BASE_URL"] === "/") {
  process.env["BASE_URL"] = "http://localhost:3000";
}

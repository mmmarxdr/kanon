/**
 * Vitest global setup.
 * Sets test environment variables before any module loads.
 */

// Set test env vars BEFORE any module imports (env.ts validates at load time)
process.env["NODE_ENV"] = "test";
process.env["DATABASE_URL"] =
  process.env["DATABASE_URL"] ??
  "postgresql://kanon:kanon@localhost:5432/kanon_test";
process.env["JWT_SECRET"] =
  process.env["JWT_SECRET"] ?? "test-jwt-secret-at-least-16-chars";
process.env["JWT_REFRESH_SECRET"] =
  process.env["JWT_REFRESH_SECRET"] ?? "test-jwt-refresh-secret-16-chars";
process.env["PORT"] = process.env["PORT"] ?? "3001";

// Vitest mirrors Vite's `import.meta.env.BASE_URL` into `process.env.BASE_URL`,
// defaulting to "/" — which pisses off `new URL(env.BASE_URL)` in service code
// (e.g. invite service builds the kanon:// link from BASE_URL host). Override
// to a valid absolute URL so the schema's default no-ops correctly.
if (!process.env["BASE_URL"] || process.env["BASE_URL"] === "/") {
  process.env["BASE_URL"] = "http://localhost:3000";
}

import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const E2E_DATABASE_NAME = "kanon_e2e";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const e2eEnvPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".env.e2e");

export function resolveSafeE2eDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const databaseUrl = env["DATABASE_URL"];

  if (env["NODE_ENV"] !== "test") {
    throw new Error("E2E database setup requires NODE_ENV=test.");
  }
  if (!databaseUrl) {
    throw new Error("E2E database setup requires a DATABASE_URL.");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new Error("E2E database setup requires a valid loopback PostgreSQL URL.");
  }

  if (parsedUrl.protocol !== "postgresql:" || !LOOPBACK_HOSTS.has(parsedUrl.hostname)) {
    throw new Error("E2E database setup requires a loopback PostgreSQL URL.");
  }
  if ([...parsedUrl.searchParams.keys()].some((key) => key.toLowerCase() === "host")) {
    throw new Error("E2E database setup requires a loopback PostgreSQL URL.");
  }
  if (parsedUrl.pathname !== `/${E2E_DATABASE_NAME}`) {
    throw new Error(`E2E database setup requires the ${E2E_DATABASE_NAME} database.`);
  }

  return databaseUrl;
}

/**
 * Establishes the only database environment accepted by the E2E entrypoint.
 * An inherited URL is validated before .env.e2e is considered; .env.e2e is a
 * fallback solely when the caller did not provide DATABASE_URL.
 */
export function establishControlledE2eEnvironment(env: NodeJS.ProcessEnv = process.env): string {
  if (env["NODE_ENV"] && env["NODE_ENV"] !== "test") {
    throw new Error("E2E database setup requires NODE_ENV=test.");
  }
  env["NODE_ENV"] = "test";

  if (!env["DATABASE_URL"]) {
    dotenv.config({ path: e2eEnvPath, processEnv: env as Record<string, string> });
  }

  return resolveSafeE2eDatabaseUrl(env);
}

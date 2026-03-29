import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, "../.env.e2e") });
dotenv.config({ path: path.resolve(__dirname, "../.env.test") });

const API_BASE = `http://localhost:${process.env["API_PORT"] ?? "3001"}`;

/**
 * Make a POST request directly to the API (bypassing the browser).
 * Useful for test data setup.
 */
export async function apiPost<T>(
  urlPath: string,
  body: object,
  token?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${urlPath}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `API POST ${urlPath} failed (${response.status}): ${text}`,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

/**
 * Make a GET request directly to the API (bypassing the browser).
 * Useful for verifying data in tests.
 */
export async function apiGet<T>(urlPath: string, token: string): Promise<T> {
  const response = await fetch(`${API_BASE}${urlPath}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `API GET ${urlPath} failed (${response.status}): ${text}`,
    );
  }

  return response.json() as Promise<T>;
}

/**
 * Login via the API directly and return the access token.
 * Useful for API-level test helpers that need auth.
 */
export async function getAuthToken(opts?: {
  email?: string;
  password?: string;
}): Promise<string> {
  dotenv.config({ path: path.resolve(__dirname, "../.env.test") });

  const email = opts?.email ?? process.env["SEED_USER_EMAIL"] ?? "dev@kanon.io";
  const password =
    opts?.password ?? process.env["SEED_USER_PASSWORD"] ?? "Password1!";

  const result = await apiPost<{ accessToken: string; refreshToken: string }>(
    "/api/auth/login",
    { email, password },
  );

  return result.accessToken;
}

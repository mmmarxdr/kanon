import { type ZodType, type ZodTypeDef, ZodError } from "zod";
import { useAuthStore } from "@/stores/auth-store";

/**
 * Read the kanon_csrf cookie value for CSRF double-submit.
 */
function getCsrfToken(): string | undefined {
  return document.cookie.match(/kanon_csrf=([^;]+)/)?.[1];
}

/**
 * HTTP methods that require CSRF protection.
 */
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Thin fetch wrapper with cookie-based auth.
 * - Uses credentials: 'include' for cookie transport
 * - Adds X-CSRF-Token header on mutation methods
 * - Auto-refreshes on 401 via POST /api/auth/refresh (cookie-based)
 * - On refresh failure, clears user state and redirects to /login
 */
export async function fetchApi<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetchWithAuth(path, init);

  // If 401, try refreshing via cookie-based refresh
  if (response.status === 401) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      // Retry the original request with the new cookie
      const retryResponse = await fetchWithAuth(path, init);
      return handleResponse<T>(retryResponse);
    }
    // Refresh failed — logout and redirect
    useAuthStore.getState().clearUser();
    window.location.href = "/login";
    throw new ApiError(401, "UNAUTHORIZED", "Session expired");
  }

  return handleResponse<T>(response);
}

/**
 * Perform a fetch with credentials and CSRF token.
 */
async function fetchWithAuth(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  const method = (init?.method ?? "GET").toUpperCase();

  // Add CSRF token on mutation methods
  if (MUTATION_METHODS.has(method)) {
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      headers.set("X-CSRF-Token", csrfToken);
    }
  }

  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(path, {
    ...init,
    headers,
    credentials: "include",
  });
}

/**
 * Attempt to refresh the access token using the refresh cookie.
 * Returns true if refresh succeeded.
 */
async function tryRefresh(): Promise<boolean> {
  try {
    const response = await fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "include",
    });

    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Parse and handle the response, throwing ApiError for non-2xx.
 */
async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let body: Record<string, unknown> = {};
    try {
      body = (await response.json()) as Record<string, unknown>;
    } catch {
      // Response may not be JSON
    }
    throw new ApiError(
      response.status,
      (body.code as string) ?? "UNKNOWN_ERROR",
      (body.message as string) ?? response.statusText,
    );
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

/**
 * Structured API error.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Thrown when a successful API response fails Zod schema validation.
 *
 * This is a DISTINCT class from ApiError — it represents a structural
 * mismatch between the runtime response and the expected schema, not an
 * HTTP error. Callers can differentiate:
 *
 *   catch (err) {
 *     if (err instanceof ApiValidationError) { … boundary mismatch … }
 *     if (err instanceof ApiError)           { … HTTP error … }
 *   }
 *
 * The original ZodError is available as `.cause` for full issue inspection.
 */
export class ApiValidationError extends Error {
  constructor(
    message: string,
    public override readonly cause: ZodError,
  ) {
    super(message);
    this.name = "ApiValidationError";
  }
}

/**
 * Fetch wrapper that validates the successful response against a Zod schema
 * before returning it. This is the "parse, don't validate" boundary.
 *
 * - On HTTP error: throws ApiError (same as fetchApi)
 * - On schema mismatch: throws ApiValidationError with path + ZodError as cause
 * - On success: returns data typed as T (inferred from schema)
 *
 * Use this instead of `fetchApi<T>` for all read paths where T has a shared
 * Zod schema. The generic T is automatically inferred from the schema — no
 * manual generic annotation needed.
 */
export async function fetchApiValidated<
  Output,
  Def extends ZodTypeDef,
  Input,
>(
  path: string,
  schema: ZodType<Output, Def, Input>,
  init?: RequestInit,
): Promise<Output> {
  const raw = await fetchApi<unknown>(path, init);

  const result = schema.safeParse(raw);

  if (!result.success) {
    throw new ApiValidationError(
      `API response validation failed for ${path}: ${result.error.message}`,
      result.error,
    );
  }

  return result.data;
}

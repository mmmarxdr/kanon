// ─── Kanon REST API Client ───────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Typed error for Kanon API failures.
 */
export class KanonApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "KanonApiError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

/**
 * Minimal project shape returned by the Kanon API.
 */
export interface KanonProject {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  engramNamespace?: string | null;
  workspaceId: string;
}

/**
 * Minimal issue shape returned by the Kanon API.
 */
export interface KanonIssue {
  id: string;
  key: string;
  title: string;
  type: string;
  state: string;
  priority: string;
  description?: string | null;
  parentId?: string | null;
  specArtifacts?: unknown;
  engramContext?: unknown;
  labels?: string[];
}

/**
 * Payload for creating an issue in Kanon.
 */
export interface CreateIssueInput {
  title: string;
  type: string;
  priority?: string;
  description?: string;
  parentId?: string;
}

export interface KanonClientOptions {
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
}

/**
 * Typed HTTP client for Kanon's REST API.
 * Uses native `fetch` (Node 18+).
 * Authenticates via X-API-Key header.
 */
export class KanonClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;

  constructor(options: KanonClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  // ─── Projects ───────────────────────────────────────────────────────────

  /**
   * Get a project by key.
   * Route: GET /api/projects/:key
   */
  async getProject(key: string): Promise<KanonProject> {
    return this.request<KanonProject>("GET", `/api/projects/${key}`);
  }

  /**
   * List projects in a workspace.
   * Route: GET /api/workspaces/:wid/projects
   */
  async listProjects(workspaceId: string): Promise<KanonProject[]> {
    return this.request<KanonProject[]>(
      "GET",
      `/api/workspaces/${workspaceId}/projects`,
    );
  }

  /**
   * Update a project by key (e.g., set engramNamespace).
   * Route: PATCH /api/projects/:key
   */
  async updateProject(
    key: string,
    body: Record<string, unknown>,
  ): Promise<KanonProject> {
    return this.request<KanonProject>("PATCH", `/api/projects/${key}`, body);
  }

  // ─── Issues ─────────────────────────────────────────────────────────────

  /**
   * Create an issue in a project.
   * Route: POST /api/projects/:key/issues
   */
  async createIssue(
    projectKey: string,
    body: CreateIssueInput | Record<string, unknown>,
  ): Promise<KanonIssue> {
    return this.request<KanonIssue>(
      "POST",
      `/api/projects/${projectKey}/issues`,
      body,
    );
  }

  /**
   * List issues for a project, optionally filtered.
   * Route: GET /api/projects/:key/issues
   */
  async listIssues(
    projectKey: string,
    filters?: Record<string, string>,
  ): Promise<KanonIssue[]> {
    let path = `/api/projects/${projectKey}/issues`;
    if (filters && Object.keys(filters).length > 0) {
      const params = new URLSearchParams(filters);
      path += `?${params.toString()}`;
    }
    return this.request<KanonIssue[]>("GET", path);
  }

  /**
   * Update an issue by key.
   * Route: PATCH /api/issues/:key
   */
  async updateIssue(
    projectKey: string,
    issueKey: string,
    body: Record<string, unknown>,
  ): Promise<KanonIssue> {
    return this.request<KanonIssue>("PATCH", `/api/issues/${issueKey}`, body);
  }

  // ─── Activity Logging ───────────────────────────────────────────────────

  /**
   * Create an activity log entry for an issue.
   * Route: POST /api/issues/:key/activity
   */
  async logActivity(
    issueKey: string,
    action: string,
    details?: Record<string, unknown>,
  ): Promise<void> {
    const body: Record<string, unknown> = { action };
    if (details !== undefined) {
      body["details"] = details;
    }
    await this.request<unknown>("POST", `/api/issues/${issueKey}/activity`, body);
  }

  // ─── Health ─────────────────────────────────────────────────────────────

  /**
   * Check if Kanon API is reachable.
   */
  async health(): Promise<boolean> {
    try {
      const data = await this.request<{ status: string }>("GET", "/health");
      return data.status === "ok";
    } catch {
      return false;
    }
  }

  // ─── Internal ───────────────────────────────────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (this.apiKey) {
      // Support both JWT tokens (Bearer) and API keys
      if (this.apiKey.startsWith("eyJ")) {
        headers["Authorization"] = `Bearer ${this.apiKey}`;
      } else {
        headers["X-API-Key"] = this.apiKey;
      }
    }
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new KanonApiError(
        0,
        "CONNECTION_ERROR",
        `Failed to connect to Kanon API at ${url}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let code = "API_ERROR";
      let message = `Kanon API returned HTTP ${response.status}: ${text}`;
      try {
        const parsed = JSON.parse(text) as { code?: string; message?: string };
        if (parsed.code) code = parsed.code;
        if (parsed.message) message = parsed.message;
      } catch {
        // use raw text
      }
      throw new KanonApiError(response.status, code, message);
    }

    return (await response.json()) as T;
  }
}

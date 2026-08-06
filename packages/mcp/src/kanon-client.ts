// ─── Kanon REST API Client ───────────────────────────────────────────────────
// Copied from packages/cli/src/kanon-client.ts with additional methods for MCP.

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Result shape returned by DELETE /api/cycles/:id.
 * Mirrors `DeleteCycleResult` in
 * packages/api/src/modules/cycle/delete-cycle.ts (the authoritative shape) —
 * kept local because the API package is not in this package's dependency graph.
 */
export interface KanonCycleDeleteResult {
  auditLogId: string;
  deletedCycleId: string;
  cycleName: string;
  detachedIssueKeys: string[];
}

/**
 * Optional per-request overrides (triage deadlines / correlation).
 * Unrelated calls keep the client-level 10s default when omitted.
 */
export interface KanonRequestOptions {
  timeoutMs?: number;
  correlationId?: string;
}

/**
 * Typed error for Kanon API failures.
 */
export class KanonApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  /**
   * Parsed `details` object from the server's error response body, when present
   * (e.g. `AppError.details` forwarded by the API's global error handler).
   * KAN-188: the 409 RECONCILIATION_REQUIRED payload carries `totalHours` here
   * so the reconcile confirm-or-adjust flow can surface it without a round-trip.
   */
  public readonly details?: Record<string, unknown>;
  /** Triage semantic category when the API returns a versioned semantic error body. */
  public readonly category?: string;
  public readonly retry?: string;
  public readonly correlationId?: string;
  public readonly apiContractVersion?: string;
  public readonly provenance?: Record<string, unknown>;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
    semantic?: {
      category?: string;
      retry?: string;
      correlationId?: string;
      apiContractVersion?: string;
      provenance?: Record<string, unknown>;
    },
  ) {
    super(message);
    this.name = "KanonApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.category = semantic?.category;
    this.retry = semantic?.retry;
    this.correlationId = semantic?.correlationId;
    this.apiContractVersion = semantic?.apiContractVersion;
    this.provenance = semantic?.provenance;
  }
}

/**
 * Auth boundary error — thrown when token refresh fails at the request() boundary.
 * Callers receiving this error should direct the user to re-run onboarding.
 */
export class McpAuthError extends Error {
  public readonly code: string;

  constructor({ code, message }: { code: string; message?: string }) {
    super(message ?? "Refresh token expired or revoked — re-run onboarding to obtain new credentials.");
    this.name = "McpAuthError";
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
  labels?: string[];
  cycle?: { id: string; name: string; state: "upcoming" | "active" | "done" } | null;
  schedule?: { startDate: string | null; dueDate: string | null; progress: number } | null;
}

/**
 * Cycle shape returned by the Kanon API list endpoint.
 */
export interface KanonCycle {
  id: string;
  name: string;
  goal: string | null;
  state: "upcoming" | "active" | "done";
  startDate: string;
  endDate: string;
  velocity: number | null;
  projectId: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Detailed cycle shape returned by GET /api/cycles/:id and the attach-issues endpoint.
 */
export interface KanonCycleDetail extends KanonCycle {
  dayIndex: number;
  days: number;
  scope: number;
  completed: number;
  scopeAdded: number;
  scopeRemoved: number;
  burnup: number[];
  scopeLine: number[];
  risks: Array<{
    id: string;
    severity: "low" | "medium" | "high";
    title: string;
    detail: string;
    action?: string;
  }>;
  issues: Array<{
    id: string;
    key: string;
    title: string;
    state: string;
    estimate?: number | null;
  }>;
  scopeEvents: Array<{
    id: string;
    issueId: string;
    type: "added" | "removed";
    reason: string | null;
    createdAt: string;
    authorId: string | null;
  }>;
}

/**
 * Minimal roadmap item shape returned by the Kanon API.
 */
export interface KanonRoadmapItem {
  id: string;
  title: string;
  description?: string | null;
  horizon: string;
  effort?: number | null;
  impact?: number | null;
  labels?: string[];
  sortOrder: number;
  targetDate?: string | null;
  promoted: boolean;
  projectId: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Minimal workspace shape returned by the Kanon API.
 */
export interface KanonWorkspace {
  id: string;
  name: string;
  slug: string;
}

/**
 * Minimal comment shape returned by the Kanon API.
 */
export interface KanonComment {
  id: string;
  body: string;
  source: string;
  issueId: string;
  authorId: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Design record shape returned by the Kanon API.
 * author is included when the route fetches it (GET /api/documents/:id, list).
 * Email is intentionally omitted — not surfaced through MCP.
 */
export interface KanonDocument {
  id: string;
  kind: "adr" | "pdr" | "rfc" | "note";
  title: string;
  body: string;
  issueId: string;
  authorId: string;
  createdAt: string;
  updatedAt: string;
  author?: { id: string; username: string };
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

/**
 * Group summary shape returned by the groups endpoint.
 */
export interface GroupSummary {
  groupKey: string;
  count: number;
  latestState: string;
  title: string;
  updatedAt: string;
}

/**
 * Batch transition result shape.
 */
export interface BatchTransitionResult {
  transitioned: number;
}

/**
 * Active worker info returned by the work session endpoints.
 */
export interface ActiveWorkerInfo {
  userId: string;
  memberId: string;
  username: string;
  startedAt: string;
  source: string;
}

export interface KanonClientOptions {
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
  /** X-Kanon-Client identity to send with every request (S1 / KAN-30).
   *  When set, the header is included in every HTTP call.
   *  When absent, the header is omitted entirely (not sent as empty string). */
  clientIdentity?: string;
}

/**
 * Typed HTTP client for Kanon's REST API.
 * Uses native `fetch` (Node 18+).
 * Authenticates via Authorization: Bearer header.
 */
export class KanonClient {
  private readonly baseUrl: string;
  private accessToken: string | undefined;
  private readonly refreshToken: string | undefined;
  private readonly timeoutMs: number;
  private readonly clientIdentity: string | undefined;
  private inflightExchange: Promise<string> | null = null;

  constructor(options: KanonClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.accessToken = options.apiKey;
    this.refreshToken = process.env["KANON_REFRESH_TOKEN"];
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.clientIdentity = options.clientIdentity;
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

  // ─── Workspaces ─────────────────────────────────────────────────────────

  /**
   * List workspaces visible to the authenticated user.
   * Route: GET /api/workspaces
   */
  async listWorkspaces(): Promise<KanonWorkspace[]> {
    return this.request<KanonWorkspace[]>("GET", "/api/workspaces");
  }

  /**
   * Create a project in a workspace.
   * Route: POST /api/workspaces/:wid/projects
   */
  async createProject(
    workspaceId: string,
    body: { key: string; name: string; description?: string },
  ): Promise<KanonProject> {
    return this.request<KanonProject>(
      "POST",
      `/api/workspaces/${workspaceId}/projects`,
      body,
    );
  }

  /**
   * Update a project by key.
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
   * Get a single issue by key.
   * Route: GET /api/issues/:key
   */
  async getIssue(key: string): Promise<KanonIssue> {
    return this.request<KanonIssue>("GET", `/api/issues/${key}`);
  }

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
    filters?: Record<string, string> & { keys?: string[] },
  ): Promise<KanonIssue[]> {
    let path = `/api/projects/${projectKey}/issues`;
    const { keys, ...rest } = filters ?? {};
    const params = new URLSearchParams(rest as Record<string, string>);
    if (keys && keys.length > 0) {
      params.set("keys", keys.join(","));
    }
    const qs = params.toString();
    if (qs) path += `?${qs}`;
    return this.request<KanonIssue[]>("GET", path);
  }

  /**
   * Update an issue by key.
   * Route: PATCH /api/issues/:key
   */
  async updateIssue(
    issueKey: string,
    body: Record<string, unknown>,
  ): Promise<KanonIssue> {
    return this.request<KanonIssue>("PATCH", `/api/issues/${issueKey}`, body);
  }

  async updateIssueSchedule(
    issueKey: string,
    body: { startDate?: string; dueDate?: string; progress?: number },
  ): Promise<unknown> {
    return this.request<unknown>("PUT", `/api/issues/${issueKey}/schedule`, body);
  }

  /**
   * Transition an issue to a new state.
   * Route: POST /api/issues/:key/transition
   */
  async transitionIssue(
    issueKey: string,
    toState: string,
  ): Promise<KanonIssue> {
    return this.request<KanonIssue>(
      "POST",
      `/api/issues/${issueKey}/transition`,
      { to_state: toState },
    );
  }

  /**
   * Reconcile captured time on an issue — clears the review→done gate by
   * stamping `timeConfirmedAt`. Exactly one of `addHours` (additive top-up)
   * or `confirmedTotalHours` (authoritative total, up or down) should be
   * provided; the server enforces mutual exclusion (400 if both are set).
   * Route: POST /api/issues/:key/reconcile-time
   */
  async reconcileTime(
    issueKey: string,
    opts: { addHours?: string; confirmedTotalHours?: string },
  ): Promise<unknown> {
    return this.request<unknown>(
      "POST",
      `/api/issues/${issueKey}/reconcile-time`,
      opts,
    );
  }

  // ─── Groups ─────────────────────────────────────────────────────────────

  /**
   * List issue groups for a project.
   * Route: GET /api/projects/:key/issues/groups
   */
  async listIssueGroups(projectKey: string): Promise<GroupSummary[]> {
    return this.request<GroupSummary[]>(
      "GET",
      `/api/projects/${projectKey}/issues/groups`,
    );
  }

  /**
   * Batch-transition all issues in a group to a new state.
   * Route: PATCH /api/projects/:key/issues/groups/:groupKey/transition
   */
  async batchTransition(
    projectKey: string,
    groupKey: string,
    toState: string,
  ): Promise<BatchTransitionResult> {
    return this.request<BatchTransitionResult>(
      "PATCH",
      `/api/projects/${projectKey}/issues/groups/${encodeURIComponent(groupKey)}/transition`,
      { to_state: toState },
    );
  }

  /**
   * Batch-transition specific issues by key to a new state.
   * Route: POST /api/projects/:key/issues/batch-transition
   */
  async batchTransitionByKeys(
    projectKey: string,
    keys: string[],
    toState: string,
  ): Promise<{ count: number; keys: string[] }> {
    return this.request<{ count: number; keys: string[] }>(
      "POST",
      `/api/projects/${projectKey}/issues/batch-transition`,
      { keys, to_state: toState },
    );
  }

  // ─── Roadmap ───────────────────────────────────────────────────────────

  /**
   * List roadmap items for a project, optionally filtered.
   * Route: GET /api/projects/:key/roadmap
   */
  async listRoadmap(
    projectKey: string,
    filters?: Record<string, string>,
  ): Promise<KanonRoadmapItem[]> {
    let path = `/api/projects/${projectKey}/roadmap`;
    if (filters && Object.keys(filters).length > 0) {
      const params = new URLSearchParams(filters);
      path += `?${params.toString()}`;
    }
    return this.request<KanonRoadmapItem[]>("GET", path);
  }

  /**
   * Create a roadmap item in a project.
   * Route: POST /api/projects/:key/roadmap
   */
  async createRoadmapItem(
    projectKey: string,
    body: Record<string, unknown>,
  ): Promise<KanonRoadmapItem> {
    return this.request<KanonRoadmapItem>(
      "POST",
      `/api/projects/${projectKey}/roadmap`,
      body,
    );
  }

  /**
   * Update a roadmap item.
   * Route: PATCH /api/projects/:key/roadmap/:id
   */
  async updateRoadmapItem(
    projectKey: string,
    itemId: string,
    body: Record<string, unknown>,
  ): Promise<KanonRoadmapItem> {
    return this.request<KanonRoadmapItem>(
      "PATCH",
      `/api/projects/${projectKey}/roadmap/${itemId}`,
      body,
    );
  }

  /**
   * Delete a roadmap item.
   * Route: DELETE /api/projects/:key/roadmap/:id
   */
  async deleteRoadmapItem(
    projectKey: string,
    itemId: string,
  ): Promise<void> {
    await this.request<void>(
      "DELETE",
      `/api/projects/${projectKey}/roadmap/${itemId}`,
    );
  }

  /**
   * Promote a roadmap item to an issue.
   * Route: POST /api/projects/:key/roadmap/:id/promote
   */
  async promoteRoadmapItem(
    projectKey: string,
    itemId: string,
    body?: Record<string, unknown>,
  ): Promise<KanonIssue> {
    return this.request<KanonIssue>(
      "POST",
      `/api/projects/${projectKey}/roadmap/${itemId}/promote`,
      body ?? {},
    );
  }

  // ─── Dependencies ──────────────────────────────────────────────────────

  /**
   * Add a dependency between two roadmap items.
   * Route: POST /api/projects/:key/roadmap/:id/dependencies
   */
  async addDependency(
    projectKey: string,
    sourceItemId: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request<unknown>(
      "POST",
      `/api/projects/${projectKey}/roadmap/${sourceItemId}/dependencies`,
      body,
    );
  }

  /**
   * Remove a dependency from a roadmap item.
   * Route: DELETE /api/projects/:key/roadmap/:id/dependencies/:depId
   */
  async removeDependency(
    projectKey: string,
    sourceItemId: string,
    dependencyId: string,
  ): Promise<void> {
    await this.request<void>(
      "DELETE",
      `/api/projects/${projectKey}/roadmap/${sourceItemId}/dependencies/${dependencyId}`,
    );
  }

  // ─── Comments ───────────────────────────────────────────────────────────

  /**
   * Post a comment on an issue.
   * Route: POST /api/issues/:key/comments
   */
  async createComment(
    issueKey: string,
    body: string,
    source: string = "engram_sync",
  ): Promise<KanonComment> {
    return this.request<KanonComment>(
      "POST",
      `/api/issues/${issueKey}/comments`,
      { body, source },
    );
  }

  // ─── Documents ──────────────────────────────────────────────────────────────

  /**
   * Create a design record on an issue.
   * Route: POST /api/issues/:key/documents
   */
  async createDocument(
    issueKey: string,
    body: { kind: string; title: string; body: string },
  ): Promise<KanonDocument> {
    return this.request<KanonDocument>(
      "POST",
      `/api/issues/${issueKey}/documents`,
      body,
    );
  }

  /**
   * List design records for an issue.
   * Route: GET /api/issues/:key/documents
   */
  async listDocuments(issueKey: string): Promise<KanonDocument[]> {
    return this.request<KanonDocument[]>(
      "GET",
      `/api/issues/${issueKey}/documents`,
    );
  }

  /**
   * Get a design record by ID.
   * Route: GET /api/documents/:id
   */
  async getDocument(documentId: string): Promise<KanonDocument> {
    return this.request<KanonDocument>(
      "GET",
      `/api/documents/${documentId}`,
    );
  }

  // ─── Cycles ─────────────────────────────────────────────────────────────

  /**
   * List cycles for a project.
   * Route: GET /api/projects/:key/cycles
   */
  async listCycles(projectKey: string): Promise<KanonCycle[]> {
    return this.request<KanonCycle[]>(
      "GET",
      `/api/projects/${projectKey}/cycles`,
    );
  }

  /**
   * Get a cycle's full detail (burnup, scope events, risks, issues).
   * Route: GET /api/cycles/:id
   */
  async getCycle(
    cycleId: string,
    options?: { includeAllScopeEvents?: boolean },
  ): Promise<KanonCycleDetail> {
    let path = `/api/cycles/${cycleId}`;
    if (options?.includeAllScopeEvents) {
      path += "?includeAllScopeEvents=true";
    }
    return this.request<KanonCycleDetail>("GET", path);
  }

  /**
   * Create a cycle in a project.
   * Route: POST /api/projects/:key/cycles
   */
  async createCycle(
    projectKey: string,
    body: {
      name: string;
      goal?: string;
      startDate: string;
      endDate: string;
      state?: "upcoming" | "active" | "done";
      attachIssueKeys?: string[];
    },
  ): Promise<KanonCycle> {
    return this.request<KanonCycle>(
      "POST",
      `/api/projects/${projectKey}/cycles`,
      body,
    );
  }

  /**
   * Attach issues to or detach issues from a cycle. Emits scope events server-side.
   * Route: POST /api/cycles/:id/issues
   */
  async attachIssuesToCycle(
    cycleId: string,
    body: { add?: string[]; remove?: string[]; reason?: string },
  ): Promise<KanonCycleDetail> {
    return this.request<KanonCycleDetail>(
      "POST",
      `/api/cycles/${cycleId}/issues`,
      body,
    );
  }

  /**
   * Close a cycle. Sets state to 'done' and computes velocity from done issues.
   * Route: POST /api/cycles/:id/close
   */
  async closeCycle(cycleId: string): Promise<KanonCycle> {
    return this.request<KanonCycle>(
      "POST",
      `/api/cycles/${cycleId}/close`,
      {},
    );
  }

  /**
   * Hard-delete a cycle by ID.
   * Active cycles are always refused (409). Non-terminal issues block deletion
   * unless force:true is passed. Returns a full KanonCycleDeleteResult.
   * Route: DELETE /api/cycles/:id
   */
  async deleteCycle(
    cycleId: string,
    opts: { force?: boolean; reason?: string },
  ): Promise<KanonCycleDeleteResult> {
    return this.request<KanonCycleDeleteResult>(
      "DELETE",
      `/api/cycles/${cycleId}`,
      { force: opts.force ?? false, reason: opts.reason },
    );
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

  // ─── Work Sessions ──────────────────────────────────────────────────────

  /**
   * Start a work session on an issue.
   * Route: POST /api/issues/:key/work-sessions
   */
  async startWork(
    issueKey: string,
    source: string = "mcp",
  ): Promise<{ session: unknown; warnings: string[]; autoAssigned: boolean }> {
    return this.request<{ session: unknown; warnings: string[]; autoAssigned: boolean }>(
      "POST",
      `/api/issues/${issueKey}/work-sessions`,
      { source },
    );
  }

  /**
   * Stop a work session on an issue.
   * Route: DELETE /api/issues/:key/work-sessions
   *
   * S2 / KAN-26: response now includes workLog when a WorkLog was persisted.
   */
  async stopWork(issueKey: string): Promise<{
    ok: boolean;
    deleted: boolean;
    workLog: { id: string; durationS: number } | null;
  }> {
    return this.request<{
      ok: boolean;
      deleted: boolean;
      workLog: { id: string; durationS: number } | null;
    }>(
      "DELETE",
      `/api/issues/${issueKey}/work-sessions`,
    );
  }

  /**
   * Send a heartbeat for an active work session.
   * Route: POST /api/issues/:key/work-sessions/heartbeat
   */
  async heartbeat(issueKey: string): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(
      "POST",
      `/api/issues/${issueKey}/work-sessions/heartbeat`,
    );
  }

  /**
   * List active work sessions for an issue.
   * Route: GET /api/issues/:key/work-sessions
   */
  async listActiveSessions(issueKey: string): Promise<ActiveWorkerInfo[]> {
    return this.request<ActiveWorkerInfo[]>(
      "GET",
      `/api/issues/${issueKey}/work-sessions`,
    );
  }

  // ─── Members ────────────────────────────────────────────────────────────

  /**
   * List effective members of a project (explicit PM rows + implicit ws owner/admin rows).
   * Route: GET /api/projects/:key/members
   * Response: { members: EffectiveMemberRow[] }
   *   Each row: userId, email, displayName, role, source ('project'|'workspace')
   *   source:'project' rows also carry pmId; source:'workspace' rows carry implicit:true.
   */
  async listProjectMembers(projectKey: string): Promise<unknown> {
    return this.request<unknown>("GET", `/api/projects/${projectKey}/members`);
  }

  // ─── Timesheet ──────────────────────────────────────────────────────────

  /**
   * List the authenticated user's own WorkLogs in a workspace.
   * Route: GET /api/me/worklogs?workspaceId=<id>[&from=...&to=...&limit=...]
   */
  async listMyWorklogs(
    workspaceId: string,
    from?: string,
    to?: string,
    limit?: number,
  ): Promise<unknown> {
    const params = new URLSearchParams({ workspaceId });
    if (from !== undefined) params.set("from", from);
    if (to !== undefined) params.set("to", to);
    if (limit !== undefined) params.set("limit", String(limit));
    return this.request<unknown>("GET", `/api/me/worklogs?${params.toString()}`);
  }

  /**
   * Promote a WorkLog to a draft TimeEntry (idempotent).
   * Route: POST /api/worklogs/:id/promote
   */
  async promoteWorklog(
    worklogId: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request<unknown>("POST", `/api/worklogs/${worklogId}/promote`, body);
  }

  /**
   * Partial-update a draft or submitted TimeEntry (owner-only, service guard).
   * Route: PATCH /api/time-entries/:id
   */
  async updateTimeEntry(
    timeEntryId: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request<unknown>("PATCH", `/api/time-entries/${timeEntryId}`, body);
  }

  /**
   * Transition a draft TimeEntry to submitted (owner-only, service guard).
   * Route: POST /api/time-entries/:id/submit
   */
  async submitTimeEntry(timeEntryId: string): Promise<unknown> {
    return this.request<unknown>("POST", `/api/time-entries/${timeEntryId}/submit`);
  }

  /**
   * Approve a submitted TimeEntry — PM gate enforced API-side.
   * Route: POST /api/time-entries/:id/approve
   */
  async approveTimeEntry(timeEntryId: string): Promise<unknown> {
    return this.request<unknown>("POST", `/api/time-entries/${timeEntryId}/approve`);
  }

  /**
   * Reject a submitted TimeEntry — PM gate enforced API-side.
   * Route: POST /api/time-entries/:id/reject
   */
  async rejectTimeEntry(
    timeEntryId: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request<unknown>("POST", `/api/time-entries/${timeEntryId}/reject`, body);
  }

  /**
   * Create an adjustment TimeEntry for an approved entry (owner-only, service guard).
   * Route: POST /api/time-entries/:id/adjust
   */
  async adjustTimeEntry(
    timeEntryId: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request<unknown>("POST", `/api/time-entries/${timeEntryId}/adjust`, body);
  }

  // ─── MCP Proposals ──────────────────────────────────────────────────────

  /**
   * Create an MCP proposal in a workspace.
   * Route: POST /api/workspaces/:id/proposals
   */
  async createProposal(
    workspaceId: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request<unknown>(
      "POST",
      `/api/workspaces/${workspaceId}/proposals`,
      body,
    );
  }

  /**
   * Apply a pending MCP proposal (developer confirmation step).
   * Route: POST /api/proposals/:id/apply
   */
  async applyProposal(proposalId: string): Promise<unknown> {
    return this.request<unknown>(
      "POST",
      `/api/proposals/${proposalId}/apply`,
    );
  }

  // ─── Issue triage (KAN-193) ─────────────────────────────────────────────

  /**
   * Read-only triage preview (prepare or validate).
   * Route: POST /api/issues/:key/triage/preview
   */
  async previewIssueTriage(
    issueKey: string,
    body: Record<string, unknown>,
    options?: KanonRequestOptions,
  ): Promise<unknown> {
    return this.request<unknown>(
      "POST",
      `/api/issues/${encodeURIComponent(issueKey)}/triage/preview`,
      body,
      options,
    );
  }

  /**
   * Persist an exact preview + seal as a typed triage proposal.
   * Route: POST /api/issues/:key/triage-proposals
   */
  async persistTriageProposal(
    issueKey: string,
    body: Record<string, unknown>,
    options?: KanonRequestOptions,
  ): Promise<unknown> {
    return this.request<unknown>(
      "POST",
      `/api/issues/${encodeURIComponent(issueKey)}/triage-proposals`,
      body,
      options,
    );
  }

  /**
   * Get one triage proposal by UUID.
   * Route: GET /api/triage-proposals/:id
   */
  async getTriageProposal(
    proposalId: string,
    format: "compact" | "full" = "compact",
    options?: KanonRequestOptions,
  ): Promise<unknown> {
    const params = new URLSearchParams({ format });
    return this.request<unknown>(
      "GET",
      `/api/triage-proposals/${encodeURIComponent(proposalId)}?${params.toString()}`,
      undefined,
      options,
    );
  }

  /**
   * List compact triage proposals for exactly one project.
   * Route: GET /api/projects/:key/triage-proposals
   */
  async listTriageProposals(
    projectKey: string,
    filters: {
      state?: string;
      targetIssueKey?: string;
      generatorSource?: string;
      degraded?: boolean;
      limit?: number;
      cursor?: string;
    } = {},
    options?: KanonRequestOptions,
  ): Promise<unknown> {
    const params = new URLSearchParams();
    if (filters.state !== undefined) params.set("state", filters.state);
    if (filters.targetIssueKey !== undefined) params.set("targetIssueKey", filters.targetIssueKey);
    if (filters.generatorSource !== undefined) {
      params.set("generatorSource", filters.generatorSource);
    }
    if (filters.degraded !== undefined) {
      params.set("degraded", filters.degraded ? "true" : "false");
    }
    if (filters.limit !== undefined) params.set("limit", String(filters.limit));
    if (filters.cursor !== undefined) params.set("cursor", filters.cursor);
    const qs = params.toString();
    const path = `/api/projects/${encodeURIComponent(projectKey)}/triage-proposals${qs ? `?${qs}` : ""}`;
    return this.request<unknown>("GET", path, undefined, options);
  }

  /**
   * Dismiss a triage proposal (terminal lifecycle write).
   * Route: POST /api/triage-proposals/:id/dismiss
   */
  async dismissTriageProposal(
    proposalId: string,
    body: { reason: string },
    options?: KanonRequestOptions,
  ): Promise<unknown> {
    return this.request<unknown>(
      "POST",
      `/api/triage-proposals/${encodeURIComponent(proposalId)}/dismiss`,
      body,
      options,
    );
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

  /**
   * Raw HTTP request — never retries. Reads this.accessToken at call time so
   * retries after a token swap automatically pick up the new value.
   */
  private async doRequest<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: KanonRequestOptions,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const timeoutMs = options?.timeoutMs ?? this.timeoutMs;

    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (this.accessToken) {
      // Bearer-only — X-API-Key path removed in PR1 (KAN-35).
      // The wrapper always supplies a short-lived access JWT (eyJ…) from the exchange endpoint.
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    // S1 / KAN-30: inject X-Kanon-Client when clientIdentity is configured.
    // Omitted entirely when absent — never sent as empty string.
    if (this.clientIdentity) {
      headers["X-Kanon-Client"] = this.clientIdentity;
    }
    if (options?.correlationId) {
      headers["X-Kanon-Correlation-ID"] = options.correlationId;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
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
      let details: Record<string, unknown> | undefined;
      let semantic:
        | {
            category?: string;
            retry?: string;
            correlationId?: string;
            apiContractVersion?: string;
            provenance?: Record<string, unknown>;
          }
        | undefined;
      try {
        const parsed = JSON.parse(text) as {
          code?: string;
          message?: string;
          details?: Record<string, unknown>;
          category?: string;
          retry?: string;
          correlationId?: string;
          apiContractVersion?: string;
          provenance?: Record<string, unknown>;
        };
        if (parsed.code) code = parsed.code;
        if (parsed.message) message = parsed.message;
        if (parsed.details) details = parsed.details;
        if (parsed.category) {
          semantic = {
            category: parsed.category,
            retry: parsed.retry,
            correlationId: parsed.correlationId,
            apiContractVersion: parsed.apiContractVersion,
            provenance: parsed.provenance,
          };
        }
      } catch {
        // use raw text
      }
      throw new KanonApiError(response.status, code, message, details, semantic);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  /**
   * Outer request wrapper — intercepts 401 and triggers a single refresh exchange,
   * then retries the original request exactly once. Non-401 errors propagate as-is.
   * If no refresh token is available, behaves identically to doRequest (no retry).
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: KanonRequestOptions,
  ): Promise<T> {
    try {
      return await this.doRequest<T>(method, path, body, options);
    } catch (err) {
      if (
        err instanceof KanonApiError &&
        err.statusCode === 401 &&
        this.refreshToken
      ) {
        try {
          await this.refreshAccessToken();
        } catch {
          // Exchange failed — translate to boundary error
          throw new McpAuthError({
            code: "REFRESH_FAILED",
            message: "Refresh token expired or revoked — re-run onboarding to obtain new credentials.",
          });
        }
        // Retry once using doRequest (never loops — doRequest never retries)
        try {
          return await this.doRequest<T>(method, path, body, options);
        } catch (retryErr) {
          // Retry 401 → boundary error (spec R1d)
          // Non-401 errors propagate as-is (spec R1c principle: non-401 never intercepted)
          if (retryErr instanceof KanonApiError && retryErr.statusCode === 401) {
            throw new McpAuthError({
              code: "REFRESH_FAILED",
              message: "Refresh token expired or revoked — re-run onboarding to obtain new credentials.",
            });
          }
          throw retryErr;
        }
      }
      throw err;
    }
  }

  /**
   * Single-flight exchange guard. Concurrent 401s all await the same promise.
   * The latch is set BEFORE the async call and cleared in finally() so a later
   * 401 can trigger a fresh exchange.
   */
  private async refreshAccessToken(): Promise<string> {
    if (!this.inflightExchange) {
      this.inflightExchange = this.doExchange()
        .then((tok) => {
          this.accessToken = tok;
          return tok;
        })
        .finally(() => {
          this.inflightExchange = null;
        });
    }
    return this.inflightExchange;
  }

  /**
   * Raw exchange call — POST /api/auth/exchange with the stored refresh token.
   * Throws KanonApiError(REFRESH_EXCHANGE_FAILED) on non-2xx.
   * NEVER logs the refresh token value — error messages contain HTTP status only.
   */
  private async doExchange(): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/auth/exchange`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ refreshToken: this.refreshToken }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      // Generic message only — never echo token values
      throw new KanonApiError(
        res.status,
        "REFRESH_EXCHANGE_FAILED",
        `Token refresh failed (HTTP ${res.status}); re-run setup login`,
      );
    }
    const data = (await res.json()) as { accessToken: string; expiresIn: number };
    return data.accessToken;
  }
}

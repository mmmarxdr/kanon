import type {
  CreateObservationPayload,
  EngramHealthResponse,
  EngramObservation,
  EngramSearchResult,
  UpdateObservationPayload,
} from "./types.js";
import { EngramConnectionError } from "./types.js";

const DEFAULT_BASE_URL = "http://localhost:7437";
const DEFAULT_TIMEOUT_MS = 5_000;

export interface EngramClientOptions {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
}

/**
 * Typed HTTP client for Engram's REST API.
 *
 * Uses native `fetch` (Node 18+). All methods throw
 * `EngramConnectionError` on network failures or non-2xx responses.
 */
export class EngramClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;

  constructor(options: EngramClientOptions = {}) {
    // Strip trailing slash for consistency
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  // ─── Public API ────────────────────────────────────────────────────────

  /**
   * Check if Engram is reachable.
   * Returns `true` if the health endpoint responds with status "ok".
   */
  async health(): Promise<boolean> {
    try {
      const data = await this.get<EngramHealthResponse>("/health");
      return data.status === "ok";
    } catch {
      return false;
    }
  }

  /**
   * Connectivity check returning structured result (R-BRG-02).
   */
  async checkConnectivity(): Promise<{
    ok: boolean;
    version?: string;
    error?: string;
  }> {
    try {
      const data = await this.get<EngramHealthResponse>("/health");
      if (data.status === "ok") {
        return { ok: true, version: data.version };
      }
      return { ok: false, error: `Unexpected status: ${data.status}` };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error";
      return {
        ok: false,
        error: `Connection refused at ${this.baseUrl}: ${message}`,
      };
    }
  }

  /**
   * Full-text search observations.
   *
   * Engram route: `GET /search?q=<query>&project=<project>&limit=<limit>`
   */
  async search(
    query: string,
    opts?: { project?: string; type?: string; limit?: number },
  ): Promise<EngramSearchResult[]> {
    const params = new URLSearchParams({ q: query });
    if (opts?.project) params.set("project", opts.project);
    if (opts?.type) params.set("type", opts.type);
    if (opts?.limit != null) params.set("limit", String(opts.limit));

    return this.get<EngramSearchResult[]>(`/search?${params.toString()}`);
  }

  /**
   * Get a single observation by ID.
   *
   * Engram route: `GET /observations/<id>`
   */
  async getObservation(id: number): Promise<EngramObservation> {
    return this.get<EngramObservation>(`/observations/${id}`);
  }

  /**
   * List recent observations, optionally filtered by project.
   *
   * Engram route: `GET /observations/recent?project=<project>&limit=<limit>`
   */
  async listRecent(
    project?: string,
    limit?: number,
  ): Promise<EngramObservation[]> {
    const params = new URLSearchParams();
    if (project) params.set("project", project);
    if (limit != null) params.set("limit", String(limit));

    const qs = params.toString();
    const path = qs ? `/observations/recent?${qs}` : "/observations/recent";
    return this.get<EngramObservation[]>(path);
  }

  /**
   * List observations updated after a given timestamp.
   *
   * Fetches recent observations from Engram and filters client-side
   * by `updated_at > since` (Engram API lacks server-side date filtering).
   *
   * @param since - ISO 8601 timestamp; only observations updated after this are returned
   * @param project - Optional project filter
   * @param limit - Max observations to fetch from Engram before filtering (default 100)
   */
  async listRecentSince(
    since: string,
    project?: string,
    limit = 100,
  ): Promise<EngramObservation[]> {
    const all = await this.listRecent(project, limit);
    const sinceDate = new Date(since).getTime();
    return all.filter((obs) => new Date(obs.updated_at).getTime() > sinceDate);
  }

  /**
   * Create a new observation in Engram (R-SYNC-01).
   *
   * Engram route: `POST /observations`
   */
  async createObservation(
    payload: CreateObservationPayload,
  ): Promise<EngramObservation> {
    return this.post<EngramObservation>("/observations", payload);
  }

  /**
   * Update an existing observation in Engram (R-SYNC-02).
   *
   * Engram route: `PATCH /observations/<id>`
   */
  async updateObservation(
    id: number,
    payload: UpdateObservationPayload,
  ): Promise<EngramObservation> {
    return this.patch<EngramObservation>(`/observations/${id}`, payload);
  }

  // ─── Internal ──────────────────────────────────────────────────────────

  private async get<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new EngramConnectionError(
        `Failed to connect to Engram at ${url}`,
        url,
        err,
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new EngramConnectionError(
        `Engram returned HTTP ${response.status}: ${body}`,
        url,
      );
    }

    return (await response.json()) as T;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new EngramConnectionError(
        `Failed to connect to Engram at ${url}`,
        url,
        err,
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new EngramConnectionError(
        `Engram returned HTTP ${response.status}: ${text}`,
        url,
      );
    }

    return (await response.json()) as T;
  }

  private async patch<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: "PATCH",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new EngramConnectionError(
        `Failed to connect to Engram at ${url}`,
        url,
        err,
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new EngramConnectionError(
        `Engram returned HTTP ${response.status}: ${text}`,
        url,
      );
    }

    return (await response.json()) as T;
  }
}

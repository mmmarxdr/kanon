import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EngramClient } from "./engram-client.js";
import { SddParser } from "./sdd-parser.js";
import { EntityMapper } from "./entity-mapper.js";
import type { EngramObservation } from "./types.js";

/**
 * Integration test: full recover flow.
 *
 * Simulates: Engram search → get observations → parse SDD artifacts → map to Kanon entities.
 * Both Engram and Kanon APIs are mocked via fetch stubs.
 */

// ─── Test Data ─────────────────────────────────────────────────────────────

const PROPOSAL_OBS: EngramObservation = {
  id: 100,
  sync_id: "sync-100",
  session_id: "sess-1",
  type: "architecture",
  title: "sdd/my-feature/proposal",
  content:
    "# Proposal: Add Dark Mode\n\nImplement dark mode toggle for the UI.",
  project: "kanon",
  scope: "project",
  topic_key: "sdd/my-feature/proposal",
  revision_count: 1,
  duplicate_count: 0,
  last_seen_at: "2026-01-01T00:00:00Z",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const SPEC_OBS: EngramObservation = {
  id: 101,
  sync_id: "sync-101",
  session_id: "sess-1",
  type: "architecture",
  title: "sdd/my-feature/spec",
  content:
    "# Spec: Dark Mode\n\nRequirements: R-DM-01 theme toggle, R-DM-02 persist preference.",
  project: "kanon",
  scope: "project",
  topic_key: "sdd/my-feature/spec",
  revision_count: 1,
  duplicate_count: 0,
  last_seen_at: "2026-01-02T00:00:00Z",
  created_at: "2026-01-02T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
};

const DESIGN_OBS: EngramObservation = {
  id: 102,
  sync_id: "sync-102",
  session_id: "sess-1",
  type: "architecture",
  title: "sdd/my-feature/design",
  content: "# Design: Dark Mode\n\nUse CSS variables + localStorage.",
  project: "kanon",
  scope: "project",
  topic_key: "sdd/my-feature/design",
  revision_count: 1,
  duplicate_count: 0,
  last_seen_at: "2026-01-03T00:00:00Z",
  created_at: "2026-01-03T00:00:00Z",
  updated_at: "2026-01-03T00:00:00Z",
};

const TASKS_OBS: EngramObservation = {
  id: 103,
  sync_id: "sync-103",
  session_id: "sess-1",
  type: "architecture",
  title: "sdd/my-feature/tasks",
  content: `# Tasks: Dark Mode

## Phase 1
- [x] 1.1 Add CSS variables for theming
- [ ] 1.2 Implement toggle component
- [ ] 1.3 Persist preference to localStorage`,
  project: "kanon",
  scope: "project",
  topic_key: "sdd/my-feature/tasks",
  revision_count: 1,
  duplicate_count: 0,
  last_seen_at: "2026-01-04T00:00:00Z",
  created_at: "2026-01-04T00:00:00Z",
  updated_at: "2026-01-04T00:00:00Z",
};

const ALL_OBS = [PROPOSAL_OBS, SPEC_OBS, DESIGN_OBS, TASKS_OBS];

// ─── Mock Fetch Router ─────────────────────────────────────────────────────

function createMockFetch() {
  // Collected Kanon API calls for assertion
  const kanonCalls: { url: string; body: unknown }[] = [];

  return vi.fn(async (url: string, init?: RequestInit) => {
    // ── Engram API routes ──

    if (url.includes("/search?")) {
      // Return search results (truncated content, like real Engram)
      const searchResults = ALL_OBS.map((obs) => ({
        ...obs,
        content: obs.content.slice(0, 100),
        rank: 1,
      }));
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve(searchResults),
        text: () => Promise.resolve(JSON.stringify(searchResults)),
      };
    }

    if (url.match(/\/observations\/(\d+)$/)) {
      const idMatch = url.match(/\/observations\/(\d+)$/);
      const id = Number(idMatch![1]);
      const obs = ALL_OBS.find((o) => o.id === id);
      if (!obs) {
        return {
          ok: false,
          status: 404,
          json: () => Promise.resolve({ error: "Not found" }),
          text: () => Promise.resolve("Not found"),
        };
      }
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve(obs),
        text: () => Promise.resolve(JSON.stringify(obs)),
      };
    }

    if (url.includes("/health")) {
      return {
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            service: "engram",
            status: "ok",
            version: "1.0.0",
          }),
        text: () => Promise.resolve("ok"),
      };
    }

    // ── Kanon API routes (mock POST /issues) ──

    if (url.includes("/api/issues") && init?.method === "POST") {
      const body = JSON.parse(init.body as string);
      kanonCalls.push({ url, body });
      return {
        ok: true,
        status: 201,
        json: () =>
          Promise.resolve({ id: `issue-${kanonCalls.length}`, ...body }),
        text: () => Promise.resolve("created"),
      };
    }

    // Default: 404
    return {
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: "Not found" }),
      text: () => Promise.resolve("Not found"),
    };
  });
}

// ─── Integration Test ──────────────────────────────────────────────────────

describe("Integration: recover flow", () => {
  let fetchMock: ReturnType<typeof createMockFetch>;

  beforeEach(() => {
    fetchMock = createMockFetch();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("discovers SDD changes via Engram search", async () => {
    const client = new EngramClient({ baseUrl: "http://engram:7437" });

    // Step 1: Health check
    const healthy = await client.health();
    expect(healthy).toBe(true);

    // Step 2: Search for SDD artifacts
    const searchResults = await client.search("sdd/my-feature", {
      project: "kanon",
    });
    expect(searchResults.length).toBeGreaterThan(0);

    // Step 3: Get full observations for each result
    const fullObs = await Promise.all(
      searchResults.map((r) => client.getObservation(r.id)),
    );
    expect(fullObs).toHaveLength(4);

    // Step 4: Group by change
    const changes = SddParser.groupByChange(fullObs);
    expect(changes).toHaveLength(1);

    const change = changes[0]!;
    expect(change.name).toBe("my-feature");
    expect(change.artifacts.size).toBe(4);
    expect(change.latestPhase).toBe("tasks");
    expect(change.tasks).toHaveLength(3);
  });

  it("maps discovered change to Kanon issue payloads", async () => {
    const client = new EngramClient({ baseUrl: "http://engram:7437" });

    // Fetch and parse
    const searchResults = await client.search("sdd/my-feature", {
      project: "kanon",
    });
    const fullObs = await Promise.all(
      searchResults.map((r) => client.getObservation(r.id)),
    );
    const changes = SddParser.groupByChange(fullObs);
    const change = changes[0]!;

    // Map to Kanon entities
    const parentIssue = EntityMapper.changeToParentIssue(change, "KANON");

    expect(parentIssue.title).toBe("Add Dark Mode");
    expect(parentIssue.type).toBe("feature");
    expect(parentIssue.state).toBe("tasks");
    expect(parentIssue.specArtifacts).toBeDefined();
    expect(parentIssue.specArtifacts!.engramId).toBe(100);

    // Map tasks to child issues
    const childIssues = change.tasks.map((t) =>
      EntityMapper.taskToChildIssue(t, change.name, "KANON"),
    );

    expect(childIssues).toHaveLength(3);
    expect(childIssues[0]!.title).toBe("Add CSS variables for theming");
    expect(childIssues[0]!.state).toBe("archived"); // done
    expect(childIssues[1]!.state).toBe("backlog"); // not done
    expect(childIssues[2]!.state).toBe("backlog"); // not done
  });

  it("extracts requirements from spec artifact", async () => {
    const client = new EngramClient({ baseUrl: "http://engram:7437" });

    const specObs = await client.getObservation(101);
    const requirements = SddParser.parseRequirements(specObs.content);

    expect(requirements).toEqual(["R-DM-01", "R-DM-02"]);
  });

  it("handles Engram being unreachable gracefully", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );

    const client = new EngramClient({ baseUrl: "http://engram:7437" });

    // Health check should return false, not throw
    const healthy = await client.health();
    expect(healthy).toBe(false);

    // Connectivity check should return structured error
    const connectivity = await client.checkConnectivity();
    expect(connectivity.ok).toBe(false);
    expect(connectivity.error).toContain("Connection refused");
  });

  it("handles missing observation (404) during recovery", async () => {
    const client = new EngramClient({ baseUrl: "http://engram:7437" });

    // Try to get a non-existent observation
    await expect(client.getObservation(999)).rejects.toThrow(/404/);
  });

  it("full register pipeline: search -> parse -> map -> post to Kanon", async () => {
    const client = new EngramClient({ baseUrl: "http://engram:7437" });

    // 1. Search Engram
    const searchResults = await client.search("sdd/", {
      project: "kanon",
    });

    // 2. Fetch full observations
    const fullObs = await Promise.all(
      searchResults.map((r) => client.getObservation(r.id)),
    );

    // 3. Parse into changes
    const changes = SddParser.groupByChange(fullObs);

    // 4. For each change, create parent + child issues
    for (const change of changes) {
      const parentPayload = EntityMapper.changeToParentIssue(change, "KANON");

      // Simulate POST to Kanon API
      const parentResp = await fetch("http://kanon:3000/api/issues", {
        method: "POST",
        body: JSON.stringify(parentPayload),
      });
      expect(parentResp.ok).toBe(true);
      const parentData = (await parentResp.json()) as { id: string };

      // Create child issues for each task
      for (const task of change.tasks) {
        const childPayload = EntityMapper.taskToChildIssue(task, change.name, "KANON");
        const childResp = await fetch("http://kanon:3000/api/issues", {
          method: "POST",
          body: JSON.stringify({
            ...childPayload,
            parentId: parentData.id,
          }),
        });
        expect(childResp.ok).toBe(true);
      }
    }

    // Verify correct number of Kanon API calls: 1 parent + 3 children
    const kanonPosts = fetchMock.mock.calls.filter(
      (call) =>
        (call[0] as string).includes("/api/issues") &&
        (call[1] as RequestInit)?.method === "POST",
    );
    expect(kanonPosts).toHaveLength(4);
  });
});

import { describe, expect, it } from "vitest";
import type { PollCheckpoint } from "../../core/types.js";
import { RedmineHttpError } from "./http-client.js";
import { RedmineAuditSource } from "./audit-source.js";

const issue = {
  id: 42, project: { id: 7, name: "Delivery" }, tracker: { id: 1, name: "Task" },
  status: { id: 2, name: "In Progress" }, priority: { id: 3, name: "High" },
  author: { id: 5, name: "Ada" }, subject: "Visible", description: "Visible body",
  start_date: null, due_date: null, done_ratio: 0, is_private: false,
  created_on: "2026-08-01T09:00:00Z", updated_on: "2026-08-02T10:30:00Z", closed_on: null,
};

function client(...responses: readonly unknown[]) {
  let index = 0;
  return {
    getWithResponse: async <T>(_path: string) => responses[index++] as T,
  };
}

const checkpoint: PollCheckpoint = {
  updatedAt: new Date("2026-08-02T10:30:00Z"), remoteId: "41", pageToken: null,
};

describe("RedmineAuditSource", () => {
  it("captures the first valid HTTP Date immutably while replaying equal timestamp tuples inclusively", async () => {
    const source = new RedmineAuditSource(client(
      { value: { issues: [issue], total_count: 1, offset: 0, limit: 1 }, httpDate: "Tue, 04 Aug 2026 10:30:00 GMT" },
      { value: { issues: [{ ...issue, id: 43 }], total_count: 1, offset: 0, limit: 1 }, httpDate: "Tue, 04 Aug 2026 10:31:00 GMT" },
    ), { remoteProjectId: "7" });

    const first = await source.readPage(0, 1, checkpoint);
    const replay = await source.readPage(0, 1, checkpoint);

    expect(first).toMatchObject({ kind: "accepted", providerObservedAt: new Date("2026-08-04T10:30:00Z"), value: { changes: [{ identity: { remoteId: "42" } }] } });
    expect(replay).toMatchObject({ kind: "accepted", providerObservedAt: new Date("2026-08-04T10:30:00Z"), value: { changes: [{ identity: { remoteId: "43" } }] } });
  });

  it("fails closed for missing, malformed, timeout, auth, rate-limit, pagination, and detail drift", async () => {
    const cases = [
      [{ value: { issues: [], total_count: 0, offset: 0, limit: 1 }, httpDate: null }, "malformed_response"],
      [{ value: { issues: [], total_count: 0, offset: 0, limit: 1 }, httpDate: "not-a-date" }, "malformed_response"],
      [new Error("Redmine request timed out"), "timeout"],
      [new RedmineHttpError(401), "unauthorized"],
      [new RedmineHttpError(429), "rate_limited"],
      [{ value: { issues: [], total_count: 1, offset: 0, limit: 1 }, httpDate: "Tue, 04 Aug 2026 10:30:00 GMT" }, "malformed_response"],
    ] as const;

    for (const [response, reasonCode] of cases) {
      const source = new RedmineAuditSource({ getWithResponse: async () => { throw response; } }, { remoteProjectId: "7" });
      if (typeof response === "object" && response !== null && "value" in response) {
        const pageSource = new RedmineAuditSource(client(response), { remoteProjectId: "7" });
        await expect(pageSource.readPage(0, 1, null)).resolves.toMatchObject({ kind: "unknown", reasonCode });
      } else {
        await expect(source.readPage(0, 1, null)).resolves.toMatchObject({ kind: "unknown", reasonCode });
      }
    }

    const source = new RedmineAuditSource(client({
      value: { issue: { ...issue, id: 99, journals: [] } }, httpDate: "Tue, 04 Aug 2026 10:30:00 GMT",
    }), { remoteProjectId: "7" });
    await expect(source.readIssue("42")).resolves.toMatchObject({ kind: "unknown", reasonCode: "detail_drift" });
  });

  it("uses deterministic direct issue and numeric journal reads without returning raw provider responses", async () => {
    const source = new RedmineAuditSource(client({
      value: { issue: { ...issue, journals: [{ id: "90", user: { id: 8, name: "Grace" }, notes: "Note", private_notes: false, created_on: "2026-08-02T10:00:00Z", updated_on: null, details: [] }] } },
      httpDate: "Tue, 04 Aug 2026 10:30:00 GMT",
    }), { remoteProjectId: "7" });

    const result = await source.readComment("42", "90");
    expect(result).toMatchObject({ kind: "visible", providerObservedAt: new Date("2026-08-04T10:30:00Z"), issueId: "42", journalId: "90" });
    expect(JSON.stringify(result)).not.toContain("Visible body");
  });

  it("labels direct 404 and missing journals as scoped non-visibility, while all other failures remain unknown", async () => {
    const missingIssue = new RedmineAuditSource({ getWithResponse: async () => { throw new RedmineHttpError(404); } }, { remoteProjectId: "7" });
    await expect(missingIssue.readIssue("42")).resolves.toEqual({ kind: "not_visible_in_scope" });

    const missingJournal = new RedmineAuditSource(client({ value: { issue: { ...issue, journals: [] } }, httpDate: "Tue, 04 Aug 2026 10:30:00 GMT" }), { remoteProjectId: "7" });
    await expect(missingJournal.readComment("42", "90")).resolves.toEqual({ kind: "not_visible_in_scope" });

    const hiddenJournal = new RedmineAuditSource({ getWithResponse: async () => { throw new RedmineHttpError(403); } }, { remoteProjectId: "7" });
    await expect(hiddenJournal.readComment("42", "90")).resolves.toEqual({ kind: "unknown", reasonCode: "unauthorized" });
  });
});

describe("RedmineAuditSource confirmed audit fixes", () => {
  it("exposes decoded detail observations for census traversal while terminal reads stay identity-only", async () => {
    const paths: string[] = [];
    const source = new RedmineAuditSource({
      getWithResponse: async <T>(path: string) => {
        paths.push(path);
        return {
          value: { issue: { ...issue, journals: [{ id: "90", user: { id: 8, name: "Grace" }, notes: "Note", private_notes: false, created_on: "2026-08-02T10:00:00Z", updated_on: null, details: [] }] } },
          httpDate: "Tue, 04 Aug 2026 10:30:00 GMT",
        } as T;
      },
    }, { remoteProjectId: "7" });

    await expect(source.readIssueDetail("42")).resolves.toMatchObject({
      kind: "accepted",
      value: {
        issue: { identity: { type: "issue", remoteId: "42" } },
        comments: [{ identity: { type: "comment", remoteId: "90", parent: { remoteId: "42" } } }],
        journalIds: ["90"],
      },
    });
    await expect(source.readIssue("42")).resolves.toEqual({
      kind: "visible", providerObservedAt: new Date("2026-08-04T10:30:00Z"), issueId: "42",
    });
    expect(paths).toEqual(["/issues/42.json?include=journals", "/issues/42.json?include=journals"]);
  });

  it("returns a detail observation with no comments when the visible issue has no eligible journals", async () => {
    const source = new RedmineAuditSource(client({
      value: { issue: { ...issue, journals: [] } }, httpDate: "Tue, 04 Aug 2026 10:30:00 GMT",
    }), { remoteProjectId: "7" });

    await expect(source.readIssueDetail("42")).resolves.toMatchObject({
      kind: "accepted",
      value: { issue: { identity: { remoteId: "42" } }, comments: [], journalIds: [] },
    });
  });

  it("requests a complete exact-project census", async () => {
    const paths: string[] = [];
    const source = new RedmineAuditSource({
      getWithResponse: async <T>(path: string) => {
        paths.push(path);
        return { value: { issues: [], total_count: 0, offset: 0, limit: 25 }, httpDate: "Tue, 04 Aug 2026 10:30:00 GMT" } as T;
      },
    }, { remoteProjectId: "7" });

    await expect(source.readPage(0, 25, null)).resolves.toMatchObject({ kind: "accepted" });
    const url = new URL(paths[0]!, "https://redmine.example");
    expect(url.pathname).toBe("/issues.json");
    expect(url.searchParams.get("project_id")).toBe("7");
    expect(url.searchParams.get("status_id")).toBe("*");
    expect(url.searchParams.get("subproject_id")).toBe("!*");
  });

  it("accepts only HTTP-date formats and rejects later clock regressions without changing the first observation", async () => {
    const formats = [
      "Tue, 04 Aug 2026 10:30:00 GMT",
      "Tuesday, 04-Aug-26 10:30:00 GMT",
      "Tue Aug  4 10:30:00 2026",
    ];
    for (const httpDate of formats) {
      const source = new RedmineAuditSource(client({ value: { issues: [], total_count: 0, offset: 0, limit: 1 }, httpDate }), { remoteProjectId: "7" });
      await expect(source.readPage(0, 1, null)).resolves.toMatchObject({ kind: "accepted", providerObservedAt: new Date("2026-08-04T10:30:00Z") });
    }

    for (const httpDate of ["2026-08-04T10:30:00Z", "August 4, 2026 10:30:00 GMT"]) {
      const source = new RedmineAuditSource(client({ value: { issues: [], total_count: 0, offset: 0, limit: 1 }, httpDate }), { remoteProjectId: "7" });
      await expect(source.readPage(0, 1, null)).resolves.toEqual({ kind: "unknown", reasonCode: "malformed_response" });
    }

    const source = new RedmineAuditSource(client(
      { value: { issues: [], total_count: 0, offset: 0, limit: 1 }, httpDate: "Tue, 04 Aug 2026 10:30:00 GMT" },
      { value: { issues: [], total_count: 0, offset: 0, limit: 1 }, httpDate: "Tue, 04 Aug 2026 10:30:00 GMT" },
      { value: { issues: [], total_count: 0, offset: 0, limit: 1 }, httpDate: "Tue, 04 Aug 2026 10:31:00 GMT" },
      { value: { issues: [], total_count: 0, offset: 0, limit: 1 }, httpDate: "Tue, 04 Aug 2026 10:29:59 GMT" },
    ), { remoteProjectId: "7" });

    await expect(source.readPage(0, 1, null)).resolves.toMatchObject({ kind: "accepted", providerObservedAt: new Date("2026-08-04T10:30:00Z") });
    await expect(source.readPage(0, 1, null)).resolves.toMatchObject({ kind: "accepted", providerObservedAt: new Date("2026-08-04T10:30:00Z") });
    await expect(source.readPage(0, 1, null)).resolves.toMatchObject({ kind: "accepted", providerObservedAt: new Date("2026-08-04T10:30:00Z") });
    await expect(source.readPage(0, 1, null)).resolves.toEqual({ kind: "unknown", reasonCode: "malformed_response" });
  });
});

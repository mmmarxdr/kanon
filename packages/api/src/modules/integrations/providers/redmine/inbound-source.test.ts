import { afterEach, describe, expect, it } from "vitest";
import { MockAgent, request } from "undici";
import { RedmineHttpClient } from "./http-client.js";
import { RedminePollingInboundSource } from "./inbound-source.js";

const agents: MockAgent[] = [];

function source(readMap = { open: "in_progress", closed: "done" } as const) {
  const agent = new MockAgent();
  agent.disableNetConnect();
  agents.push(agent);
  const pool = agent.get("https://redmine.example");
  const client = new RedmineHttpClient("https://redmine.example", "secret", {
    resolve: async () => [{ address: "203.0.114.10", family: 4 }],
    transport: (url, options) => request(url, { ...options, dispatcher: agent }),
  });
  return {
    agent,
    pool,
    source: new RedminePollingInboundSource(client, {
      remoteProjectId: "remote/project",
      readMap,
    }),
  };
}

afterEach(async () => {
  await Promise.all(agents.splice(0).map((agent) => agent.close()));
});

describe("RedminePollingInboundSource", () => {
  it("polls every stable updated_on/id page and returns the final cursor", async () => {
    const { agent, pool, source: inbound } = source();
    pool
      .intercept({
        method: "GET",
        path: "/issues.json?project_id=remote%2Fproject&status_id=*&sort=updated_on%3Aasc%2Cid%3Aasc&limit=100&offset=0",
      })
      .reply(200, {
        total_count: 3,
        offset: 0,
        limit: 2,
        issues: [
          { id: 10, status: { id: "open" }, updated_on: "2026-08-01T10:00:00Z" },
          { id: 11, status: { id: "open" }, updated_on: "2026-08-01T10:00:00Z" },
        ],
      });
    pool
      .intercept({
        method: "GET",
        path: "/issues.json?project_id=remote%2Fproject&status_id=*&sort=updated_on%3Aasc%2Cid%3Aasc&limit=100&offset=2",
      })
      .reply(200, {
        total_count: 3,
        offset: 2,
        limit: 2,
        issues: [
          { id: 12, status: { id: "closed" }, updated_on: "2026-08-01T10:01:00Z" },
        ],
      });

    await expect(inbound.poll(null)).resolves.toMatchObject({
      changes: [
        { entityId: "10", state: "in_progress", operation: "update" },
        { entityId: "11", state: "in_progress", operation: "update" },
        { entityId: "12", state: "done", operation: "close" },
      ],
      nextCursor: { updatedAt: new Date("2026-08-01T10:01:00Z"), entityId: "12" },
      hasMore: false,
    });
    agent.assertNoPendingInterceptors();
  });

  it("uses an inclusive watermark and removes the consumed same-timestamp tuple", async () => {
    const { agent, pool, source: inbound } = source();
    pool
      .intercept({
        method: "GET",
        path: "/issues.json?project_id=remote%2Fproject&status_id=*&sort=updated_on%3Aasc%2Cid%3Aasc&limit=100&offset=0&updated_on=%3E%3D2026-08-01T10%3A00%3A00Z",
      })
      .reply(200, {
        total_count: 2,
        offset: 0,
        limit: 100,
        issues: [
          { id: 10, status: { id: "open" }, updated_on: "2026-08-01T10:00:00Z" },
          { id: 11, status: { id: "closed" }, updated_on: "2026-08-01T10:00:00Z" },
        ],
      });

    await expect(
      inbound.poll({ updatedAt: new Date("2026-08-01T10:00:00Z"), entityId: "10" }),
    ).resolves.toMatchObject({
      changes: [{ entityId: "11", state: "done", operation: "close" }],
      nextCursor: { updatedAt: new Date("2026-08-01T10:00:00Z"), entityId: "11" },
    });
    agent.assertNoPendingInterceptors();
  });

  it("rejects offset pagination that returns the same issue twice", async () => {
    const { pool, source: inbound } = source();
    pool
      .intercept({
        method: "GET",
        path: "/issues.json?project_id=remote%2Fproject&status_id=*&sort=updated_on%3Aasc%2Cid%3Aasc&limit=100&offset=0",
      })
      .reply(200, {
        total_count: 2,
        offset: 0,
        limit: 1,
        issues: [{ id: 10, status: { id: "open" }, updated_on: "2026-08-01T10:00:00Z" }],
      });
    pool
      .intercept({
        method: "GET",
        path: "/issues.json?project_id=remote%2Fproject&status_id=*&sort=updated_on%3Aasc%2Cid%3Aasc&limit=100&offset=1",
      })
      .reply(200, {
        total_count: 2,
        offset: 1,
        limit: 1,
        issues: [{ id: 10, status: { id: "closed" }, updated_on: "2026-08-01T10:01:00Z" }],
      });

    await expect(inbound.poll(null)).rejects.toThrow(
      "Redmine issue pagination changed during polling",
    );
  });
});

import { describe, it, expect, beforeEach, afterAll, beforeAll } from "vitest";
import { searchIssues, normalizeSearchQuery } from "./search.js";
import { IssueSearchInputSchema } from "./contracts.js";
import { prisma } from "../../config/prisma.js";
import {
  seedTestWorkspace,
  seedTestMember,
  seedTestProject,
  cleanDatabase,
  disconnectTestDb,
} from "../../test/helpers.js";

describe("searchIssues (KAN-193 PR4)", () => {
  let workspaceId: string;
  let userId: string;
  let projectId: string;

  beforeAll(async () => {
    // global setup
  });

  afterAll(async () => {
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await cleanDatabase();
    const ws = await seedTestWorkspace("Search Workspace");
    workspaceId = ws.id;

    const memberData = await seedTestMember(workspaceId);
    userId = memberData.userId;

    const project = await seedTestProject(workspaceId, "SRC");
    projectId = project.id;

    await prisma.member.update({
      where: { id: memberData.id },
      data: { role: "admin" },
    });
  });

  it("normalizes search query text with NFKC and caps at 12 tokens", () => {
    const tokens = normalizeSearchQuery("  Hello   World   One Two Three Four Five Six Seven Eight Nine Ten Eleven Twelve Thirteen  ");
    expect(tokens.length).toBe(12);
    expect(tokens[0]).toBe("hello");
    expect(tokens[1]).toBe("world");
  });

  it("rejects empty or whitespace-only search query", async () => {
    await expect(
      searchIssues(workspaceId, userId, {
        q: "   ",
        limit: 10,
        projection: "compact",
        scope: { kind: "workspace", workspaceId },
      })
    ).rejects.toThrow(/contains no valid tokens/);
  });

  it("searches and returns candidate issues matching query in title or key", async () => {
    const issue1 = await prisma.issue.create({
      data: {
        key: "SRC-1",
        title: "Fix authentication bug",
        projectId,
        sequenceNum: 1,
      },
    });

    const issue2 = await prisma.issue.create({
      data: {
        key: "SRC-2",
        title: "Update database schema",
        projectId,
        sequenceNum: 2,
      },
    });

    const res = await searchIssues(workspaceId, userId, {
      q: "authentication",
      limit: 10,
      projection: "compact",
      scope: { kind: "workspace", workspaceId },
    });

    expect(res.contractVersion).toBe("issue-search.v1");
    expect(res.completeness).toBe("complete");
    expect(res.returnedCount).toBe(1);
    expect(res.rows[0].issueKey).toBe("SRC-1");
  });

  it("excludes target issue when targetIssueId is provided", async () => {
    const issue1 = await prisma.issue.create({
      data: {
        key: "SRC-1",
        title: "Triage target issue",
        projectId,
        sequenceNum: 1,
      },
    });

    const issue2 = await prisma.issue.create({
      data: {
        key: "SRC-2",
        title: "Triage candidate issue",
        projectId,
        sequenceNum: 2,
      },
    });

    const res = await searchIssues(workspaceId, userId, {
      q: "triage",
      targetIssueId: issue1.id,
      limit: 10,
      projection: "compact",
    });

    expect(res.returnedCount).toBe(1);
    expect(res.rows[0].issueKey).toBe("SRC-2");
  });

  it("sets completeness to bounded and returns nextCursor when results exceed limit", async () => {
    for (let i = 1; i <= 3; i++) {
      await prisma.issue.create({
        data: {
          key: `SRC-${i}`,
          title: `Search item ${i}`,
          projectId,
          sequenceNum: i,
        },
      });
    }

    const res = await searchIssues(workspaceId, userId, {
      q: "search",
      limit: 2,
      projection: "compact",
      scope: { kind: "workspace", workspaceId },
    });

    expect(res.completeness).toBe("bounded");
    expect(res.returnedCount).toBe(2);
    expect(res.nextCursor).toBeDefined();

    const second = await searchIssues(workspaceId, userId, {
      q: "search",
      limit: 2,
      projection: "compact",
      scope: { kind: "workspace", workspaceId },
      cursor: res.nextCursor,
    });
    expect(second.rows).toHaveLength(1);
    expect(second.rows[0].rank).toBe(3);
    expect(second.nextCursor).toBeUndefined();
  });

  it("matches normalized query tokens regardless of title order", async () => {
    await prisma.issue.create({
      data: { key: "SRC-1", title: "Login failure", projectId, sequenceNum: 1 },
    });

    const response = await searchIssues(workspaceId, userId, {
      q: "failure login",
      limit: 10,
      projection: "compact",
      scope: { kind: "workspace", workspaceId },
    });

    expect(response.rows.map((row) => row.issueKey)).toEqual(["SRC-1"]);
  });

  it("includes partial token overlap after stronger matches", async () => {
    await prisma.issue.createMany({
      data: [
        { key: "SRC-1", title: "Login failure", projectId, sequenceNum: 1 },
        { key: "SRC-2", title: "Login timeout", projectId, sequenceNum: 2 },
      ],
    });

    const response = await searchIssues(workspaceId, userId, {
      q: "login-failure",
      limit: 10,
      projection: "compact",
      scope: { kind: "workspace", workspaceId },
    });

    expect(response.rows.map((row) => row.issueKey)).toEqual(["SRC-1", "SRC-2"]);
  });

  it("ranks an exact punctuated issue key first", async () => {
    await prisma.issue.createMany({
      data: [
        { key: "SRC-1", title: "Unrelated", projectId, sequenceNum: 1 },
        { key: "SRC-2", title: "SRC 1 mentioned", projectId, sequenceNum: 2 },
      ],
    });

    const response = await searchIssues(workspaceId, userId, {
      q: "SRC-1",
      limit: 10,
      projection: "compact",
      scope: { kind: "workspace", workspaceId },
    });

    expect(response.rows[0].issueKey).toBe("SRC-1");
  });

  it("paginates maximum-length Unicode titles with a bounded cursor", async () => {
    await prisma.issue.createMany({
      data: Array.from({ length: 3 }, (_, index) => ({
        key: `SRC-${index + 1}`,
        title: `${"😀".repeat(220)} cursor ${index}`,
        projectId,
        sequenceNum: index + 1,
      })),
    });

    const first = await searchIssues(workspaceId, userId, {
      q: "cursor",
      limit: 1,
      projection: "compact",
      scope: { kind: "workspace", workspaceId },
    });
    const second = await searchIssues(workspaceId, userId, {
      q: "cursor",
      limit: 1,
      projection: "compact",
      scope: { kind: "workspace", workspaceId },
      cursor: first.nextCursor,
    });

    expect(first.nextCursor?.length).toBeLessThanOrEqual(8192);
    expect(second.rows).toHaveLength(1);
    expect(second.rows[0].issueId).not.toBe(first.rows[0].issueId);
  });

  it("returns bounded full excerpts only for full projection", async () => {
    await prisma.issue.create({
      data: {
        key: "SRC-1",
        title: "Login failure",
        description: "Detailed candidate evidence",
        projectId,
        sequenceNum: 1,
      },
    });
    const input = {
      q: "login",
      limit: 10,
      scope: { kind: "workspace" as const, workspaceId },
    };

    const [compact, full] = await Promise.all([
      searchIssues(workspaceId, userId, { ...input, projection: "compact" }),
      searchIssues(workspaceId, userId, { ...input, projection: "full" }),
    ]);

    expect(compact.rows[0]).not.toHaveProperty("descriptionExcerpt");
    expect(full.rows[0]).toMatchObject({ descriptionExcerpt: "Detailed candidate evidence" });
  });

  it("rejects malformed and unsupported filters before SQL", () => {
    const base = {
      q: "login",
      projection: "compact",
      scope: { kind: "workspace", workspaceId },
    };
    expect(IssueSearchInputSchema.safeParse({ ...base, filters: { assignee: "not-a-uuid" } }).success).toBe(false);
    expect(IssueSearchInputSchema.safeParse({ ...base, filters: { state: "unknown" } }).success).toBe(false);
  });

  it("excludes archived projects from workspace search", async () => {
    await prisma.project.update({ where: { id: projectId }, data: { archived: true } });
    await prisma.issue.create({
      data: { key: "SRC-1", title: "Login failure", projectId, sequenceNum: 1 },
    });

    const response = await searchIssues(workspaceId, userId, {
      q: "login",
      limit: 10,
      projection: "compact",
      scope: { kind: "workspace", workspaceId },
    });

    expect(response.rows).toEqual([]);
  });

  it("rejects continuation when the authorized matching population changes", async () => {
    const issues = await Promise.all(Array.from({ length: 3 }, (_, index) =>
      prisma.issue.create({
        data: {
          key: `SRC-${index + 1}`,
          title: `Cursor item ${index + 1}`,
          projectId,
          sequenceNum: index + 1,
        },
      }),
    ));
    const first = await searchIssues(workspaceId, userId, {
      q: "cursor",
      limit: 1,
      projection: "compact",
      scope: { kind: "workspace", workspaceId },
    });
    await prisma.issue.update({
      where: { id: issues[2].id },
      data: { title: "Cursor item changed" },
    });

    await expect(searchIssues(workspaceId, userId, {
      q: "cursor",
      limit: 1,
      projection: "compact",
      scope: { kind: "workspace", workspaceId },
      cursor: first.nextCursor,
    })).rejects.toMatchObject({ code: "CURSOR_SOURCE_CONFLICT" });
  });

  it("applies credential project scope to the target anchor", async () => {
    const target = await prisma.issue.create({
      data: { key: "SRC-1", title: "Scoped target", projectId, sequenceNum: 1 },
    });

    await expect(searchIssues(workspaceId, userId, {
      q: "scoped",
      targetIssueId: target.id,
      limit: 10,
      projection: "compact",
    }, ["00000000-0000-4000-8000-000000000099"])).rejects.toMatchObject({
      code: "NOT_FOUND_OR_NOT_VISIBLE",
    });
  });

  it("rejects project scope without targetIssueId", async () => {
    await expect(
      searchIssues(workspaceId, userId, {
        q: "authentication",
        limit: 10,
        projection: "compact",
        scope: { kind: "project" },
      }),
    ).rejects.toMatchObject({ code: "SCOPE_MISMATCH" });
  });

  it("rejects unknown or invisible targetIssueId", async () => {
    await expect(
      searchIssues(workspaceId, userId, {
        q: "authentication",
        limit: 10,
        projection: "compact",
        scope: { kind: "workspace", workspaceId },
        targetIssueId: "00000000-0000-4000-8000-000000000099",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND_OR_NOT_VISIBLE" });
  });
});

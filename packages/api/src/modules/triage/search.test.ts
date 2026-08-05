import { describe, it, expect, beforeEach, afterAll, beforeAll } from "vitest";
import { searchIssues, normalizeSearchQuery } from "./search.js";
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
    });

    expect(res.completeness).toBe("bounded");
    expect(res.returnedCount).toBe(2);
    expect(res.nextCursor).toBeDefined();
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
        targetIssueId: "00000000-0000-4000-8000-000000000099",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND_OR_NOT_VISIBLE" });
  });
});

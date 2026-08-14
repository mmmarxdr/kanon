import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildRepresentativeProposalListPlanStatement } from "./proposal-list.js";
import { buildRepresentativeSearchPlanStatement } from "./search.js";

function normalizeSql(statement: { sql: string }): string {
  return statement.sql.replace(/\s+/gu, " ").trim();
}

describe("triage SQL plan builders", () => {
  it("routes production page queries through the shared builders", async () => {
    const [searchSource, proposalListSource] = await Promise.all([
      readFile(new URL("./search.ts", import.meta.url), "utf8"),
      readFile(new URL("./proposal-list.ts", import.meta.url), "utf8"),
    ]);
    expect(searchSource).toContain("tx.$queryRaw<SearchSqlRow[]>(buildSearchPageStatement({");
    expect(proposalListSource).toContain("const visibleCte = buildVisibleProposalsCte({");
    expect(proposalListSource).toContain(
      ">>(buildProposalListPageStatement({ visibleCte, state, snapshotAt, seekPredicate, limit }))",
    );
  });

  it("preserves search authorization, ranking, ordering, and the 11-row binding", () => {
    const statement = buildRepresentativeSearchPlanStatement({
      workspaceId: "10000000-0000-4000-8000-000000000001",
      userId: "10000000-0000-4000-8000-000000000002",
      projectId: "10000000-0000-4000-8000-000000000003",
    });
    const sql = normalizeSql(statement);
    expect(sql).toContain("WITH authorized_projects AS");
    expect(sql).toContain("FROM members m");
    expect(sql).toContain("FROM project_members pm");
    expect(sql).toContain("WHEN LOWER(i.key) = ? THEN 1");
    expect(sql).toContain("WHEN LOWER(i.title) = ? THEN 3");
    expect(sql).toContain(
      'ORDER BY page."matchRank", page."tokenOverlap" DESC, page."normalizedTitle", page."issueKey", page."issueId"',
    );
    expect(statement.values[statement.values.length - 1]).toBe(11);
  });

  it("preserves proposal lifecycle, successor, ordering, and the 51-row binding", () => {
    const statement = buildRepresentativeProposalListPlanStatement(
      "10000000-0000-4000-8000-000000000003",
      new Date("2026-01-01T00:00:00.000Z"),
    );
    const sql = normalizeSql(statement);
    expect(sql).toContain("FROM triage_proposal_lifecycle_events event");
    expect(sql).toContain("ORDER BY event.created_at DESC, event.id DESC LIMIT 1");
    expect(sql).toContain("WHERE child.supersedes_id = tp.id AND child.created_at <= ?");
    expect(sql).toContain("ORDER BY child.created_at, child.id LIMIT 1");
    expect(sql).toContain("e.snapshot_lifecycle = 'pending' AND e.expires_at > ? AND e.successor_id IS NULL");
    expect(sql).toContain("ORDER BY e.created_at DESC, e.id DESC LIMIT ?");
    expect(statement.values[statement.values.length - 1]).toBe(51);
  });
});

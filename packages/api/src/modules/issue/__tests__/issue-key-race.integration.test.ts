// ─── KAN-53 — Issue key race condition: real-DB integration test ─────────────
//
// Proves that concurrent createIssue calls never produce duplicate sequenceNums
// at the Postgres level (not just mock wiring).
//
// The old MAX+1 implementation read the same aggregate snapshot across concurrent
// transactions → all produce sequenceNum=1 → second insert dies with P2002.
//
// The fix uses prisma.project.update({ data: { lastSequenceNum: { increment: 1 } } })
// which maps to UPDATE … RETURNING with a row-level lock, serialising concurrent
// increments inside Postgres.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  seedTestWorkspace,
  seedTestMemberWithRole,
  seedTestProject,
  seedTestProjectMember,
  cleanDatabase,
  disconnectTestDb,
} from "../../../test/helpers.js";
import { createIssue } from "../service.js";

describe("KAN-53 — concurrent createIssue: no duplicate sequenceNums (real DB)", () => {
  let projectId: string;
  let memberId: string;

  beforeAll(async () => {
    // nothing — DB already connected via prisma singleton
  });

  afterAll(async () => {
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await cleanDatabase();

    const ws = await seedTestWorkspace();
    const member = await seedTestMemberWithRole(ws.id, "member");
    memberId = member.id;

    const project = await seedTestProject(ws.id, "RACE");
    projectId = project.id;

    await seedTestProjectMember(member.userId, project.id, "member");
  });

  it("10 concurrent creates yield 10 distinct contiguous sequenceNums — zero rejections", async () => {
    const N = 10;

    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        createIssue(projectId, { title: `Concurrent Issue ${i + 1}` }, memberId),
      ),
    );

    const seqNums = results.map((r) => r.sequenceNum).sort((a, b) => a - b);
    const keys = results.map((r) => r.key);

    // All N must be distinct
    expect(new Set(seqNums).size).toBe(N);

    // Must be exactly 1..N. Contiguity here only asserts zero failures occurred
    // in THIS run — it is NOT a production invariant: a failed insert after the
    // counter increment burns a number and leaves a gap (intentional, see
    // nextIssueKey gap semantics).
    expect(seqNums).toEqual(Array.from({ length: N }, (_, i) => i + 1));

    // All keys distinct
    expect(new Set(keys).size).toBe(N);

    // Each key matches the sequenceNum pattern RACE-{n}
    for (const result of results) {
      expect(result.key).toBe(`RACE-${result.sequenceNum}`);
    }
  });

  it("sequential creates after concurrent batch continue from correct counter", async () => {
    const N = 5;

    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        createIssue(projectId, { title: `Batch Issue ${i + 1}` }, memberId),
      ),
    );

    // One more create after the batch — must get sequenceNum N+1
    const extra = await createIssue(
      projectId,
      { title: "Post-batch issue" },
      memberId,
    );

    expect(extra.sequenceNum).toBe(N + 1);
    expect(extra.key).toBe(`RACE-${N + 1}`);
  });
});

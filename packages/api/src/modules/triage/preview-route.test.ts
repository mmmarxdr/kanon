import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../config/prisma.js";
import {
  authHeader,
  cleanDatabase,
  createTestApp,
  disconnectTestDb,
  generateTestToken,
  seedTestMember,
  seedTestProject,
  seedTestWorkspace,
} from "../../test/helpers.js";

describe("KAN-193 preview and persistence routes", () => {
  let app: FastifyInstance;
  let token: string;
  let targetKey: string;
  let workspaceId: string;
  let targetProjectId: string;
  let userId: string;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
    await disconnectTestDb();
  });
  beforeEach(async () => {
    await cleanDatabase();
    const workspace = await seedTestWorkspace(`triage-${randomUUID().slice(0, 8)}`);
    const member = await seedTestMember(workspace.id);
    const project = await seedTestProject(workspace.id, `T${randomUUID().slice(0, 4)}`);
    workspaceId = workspace.id;
    targetProjectId = project.id;
    userId = member.userId;
    token = member.token;
    await prisma.projectMember.create({
      data: { projectId: project.id, userId: member.userId, role: "member" },
    });
    await prisma.triagePolicy.create({
      data: { workspaceId: workspace.id, version: "triage-policy.v1", retentionDays: 30 },
    });
    const target = await prisma.issue.create({
      data: {
        projectId: project.id,
        key: `${project.key}-1`,
        sequenceNum: 1,
        title: "Login failure",
        priority: "high",
      },
    });
    targetKey = target.key;
    await prisma.issue.create({
      data: {
        projectId: project.id,
        key: `${project.key}-2`,
        sequenceNum: 2,
        title: "Login failure duplicate",
      },
    });
  });
  async function prepare(aiIntent: "none" | "host_assisted" = "none") {
    return app.inject({
      method: "POST",
      url: `/api/issues/${targetKey}/triage/preview`,
      headers: authHeader(token),
      payload: { phase: "prepare", aiIntent, format: "compact" },
    });
  }

  async function raceProposalWrites<T>(run: () => Promise<T>, supersedesId?: string): Promise<T> {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_block_triage_proposal_insert ON "triage_proposals"`);
    if (!supersedesId) {
      await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION test_block_triage_proposal_insert() RETURNS trigger AS $$
        BEGIN PERFORM pg_advisory_xact_lock(193346); RETURN NEW; END; $$ LANGUAGE plpgsql`);
      await prisma.$executeRawUnsafe(`CREATE TRIGGER test_block_triage_proposal_insert BEFORE INSERT ON "triage_proposals"
        FOR EACH ROW EXECUTE FUNCTION test_block_triage_proposal_insert()`);
    }
    try {
      let locked!: () => void;
      let release!: () => void;
      const lockReady = new Promise<void>((resolve) => { locked = resolve; });
      const hold = new Promise<void>((resolve) => { release = resolve; });
      const blocker = prisma.$transaction(async (transaction) => {
        if (supersedesId) {
          await transaction.$queryRaw`SELECT "id" FROM "triage_proposals" WHERE "id" = ${supersedesId}::uuid FOR UPDATE`;
        } else {
          await transaction.$executeRaw`SELECT pg_advisory_xact_lock(193346)`;
        }
        locked();
        await hold;
      });
      await Promise.race([lockReady, blocker]);
      const result = run();
      try {
        await vi.waitFor(async () => {
          const [row] = await prisma.$queryRaw<Array<{ count: number }>>`
            SELECT COUNT(*)::int AS "count" FROM pg_stat_activity
            WHERE datname = current_database() AND pid <> pg_backend_pid()
              AND wait_event_type = 'Lock'
              AND query ILIKE ${supersedesId ? '%FROM "triage_proposals"%FOR UPDATE%' : "%INSERT%triage_proposals%"}
          `;
          expect(row?.count).toBeGreaterThanOrEqual(2);
        }, { timeout: 15_000 });
      } finally {
        release();
        await Promise.all([blocker.catch(() => undefined), result.catch(() => undefined)]);
      }
      return await result;
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_block_triage_proposal_insert ON "triage_proposals"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS test_block_triage_proposal_insert()`);
    }
  }

  it("previews deterministically without domain or proposal writes", async () => {
    const before = await Promise.all([
      prisma.issue.findMany({ orderBy: { key: "asc" } }),
      prisma.activityLog.count(),
      prisma.triageProposal.count(),
    ]);

    const response = await prepare();
    const repeated = await prepare();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      contractVersion: "triage-preview.v1",
      target: { issueKey: targetKey },
      recommendations: [{ source: "deterministic_policy", state: "supported" }],
      candidates: [{ rank: 1 }],
    });
    expect(response.json().previewSeal).toMatch(/^seal\.v1\./);
    const stableFields = ({ recommendations, candidates, conflicts, unknowns, degradation }: Record<string, unknown>) => ({
      recommendations,
      candidates,
      conflicts,
      unknowns,
      degradation,
    });
    expect(stableFields(repeated.json())).toEqual(stableFields(response.json()));
    expect(response.json().correlationId).toBe(response.headers["x-kanon-correlation-id"]);
    const searchRows = await app.triageMetrics.searchRows.get();
    expect(searchRows.values).toEqual(expect.arrayContaining([
      expect.objectContaining({ labels: { measure: "logical_scanned" } }),
      expect.objectContaining({ labels: { measure: "returned" } }),
    ]));
    await expect(prisma.issue.findMany({ orderBy: { key: "asc" } })).resolves.toEqual(before[0]);
    await expect(prisma.activityLog.count()).resolves.toBe(before[1]);
    await expect(prisma.triageProposal.count()).resolves.toBe(before[2]);
  });

  it("validates bounded host metadata against prepared evidence", async () => {
    const prepared = (await prepare("host_assisted")).json();
    const evidenceRefId = prepared.recommendations[0].evidence[0].evidenceRefId;

    const response = await app.inject({
      method: "POST",
      url: `/api/issues/${targetKey}/triage/preview`,
      headers: authHeader(token),
      payload: {
        phase: "validate",
        contextToken: prepared.contextToken,
        hostOutcome: {
          status: "completed",
          provider: "test",
          model: "test-model",
          modelVersion: "1",
        },
        suggestions: [{
          concept: "impact",
          value: "customer-facing",
          reason: "Login failure blocks users",
          evidenceRefIds: [evidenceRefId],
          confidence: "medium",
          confidenceBasis: "Target priority evidence",
        }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().recommendations).toEqual(
      expect.arrayContaining([expect.objectContaining({ source: "host_ai", state: "supported" })]),
    );
    await expect(prisma.triageProposal.count()).resolves.toBe(0);
  });

  it("marks policy and host disagreements as conflicts", async () => {
    const prepared = (await prepare("host_assisted")).json();
    const evidenceRefId = prepared.recommendations[0].evidence[0].evidenceRefId;

    const response = await app.inject({
      method: "POST",
      url: `/api/issues/${targetKey}/triage/preview`,
      headers: authHeader(token),
      payload: {
        phase: "validate",
        contextToken: prepared.contextToken,
        hostOutcome: {
          status: "completed",
          provider: "test",
          model: "test-model",
          modelVersion: "1",
        },
        suggestions: [{
          concept: "urgency",
          value: "low",
          reason: "Host disagrees with the direct priority mapping",
          evidenceRefIds: [evidenceRefId],
          confidence: "medium",
          confidenceBasis: "Target priority evidence",
        }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().recommendations).toEqual([
      expect.objectContaining({ source: "deterministic_policy", state: "conflict" }),
      expect.objectContaining({ source: "host_ai", state: "conflict" }),
    ]);
    expect(response.json().conflicts).toEqual([
      "policy:priority-urgency:v1",
      "host:1",
    ]);
  });

  it("marks contradictory host recommendations as conflicts", async () => {
    const prepared = (await prepare("host_assisted")).json();
    const evidenceRefId = prepared.recommendations[0].evidence[0].evidenceRefId;
    const suggestion = (value: string) => ({
      concept: "impact",
      value,
      reason: `Impact is ${value}`,
      evidenceRefIds: [evidenceRefId],
      confidence: "medium",
      confidenceBasis: "Target priority evidence",
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/issues/${targetKey}/triage/preview`,
      headers: authHeader(token),
      payload: {
        phase: "validate",
        contextToken: prepared.contextToken,
        hostOutcome: {
          status: "completed",
          provider: "test",
          model: "test-model",
          modelVersion: "1",
        },
        suggestions: [suggestion("low"), suggestion("high")],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().recommendations.slice(1)).toEqual([
      expect.objectContaining({ itemId: "host:1", state: "conflict" }),
      expect.objectContaining({ itemId: "host:2", state: "conflict" }),
    ]);
    expect(response.json().conflicts).toEqual(["host:1", "host:2"]);
  });

  it("uses the same not-found response for missing and invisible targets", async () => {
    const hiddenWorkspace = await seedTestWorkspace(`hidden-${randomUUID().slice(0, 8)}`);
    const hiddenProject = await seedTestProject(hiddenWorkspace.id, `H${randomUUID().slice(0, 4)}`);
    const hidden = await prisma.issue.create({
      data: {
        projectId: hiddenProject.id,
        key: `${hiddenProject.key}-1`,
        sequenceNum: 1,
        title: "Hidden target",
      },
    });

    const [missing, invisible] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/issues/DOES-NOT-EXIST/triage/preview",
        headers: authHeader(token),
        payload: { phase: "prepare" },
      }),
      app.inject({
        method: "POST",
        url: `/api/issues/${hidden.key}/triage/preview`,
        headers: authHeader(token),
        payload: { phase: "prepare" },
      }),
    ]);

    expect(missing.statusCode).toBe(404);
    expect(invisible.statusCode).toBe(404);
    expect(invisible.json()).toEqual(missing.json());
  });

  it("intersects workspace candidates with the credential project scope", async () => {
    const foreign = await seedTestProject(workspaceId, `F${randomUUID().slice(0, 4)}`);
    await prisma.projectMember.create({
      data: { projectId: foreign.id, userId, role: "member" },
    });
    await prisma.issue.create({
      data: {
        projectId: foreign.id,
        key: `${foreign.key}-1`,
        sequenceNum: 1,
        title: "Login failure outside token scope",
      },
    });
    const scopedToken = generateTestToken({ userId, allowedProjectIds: [targetProjectId] });

    const response = await app.inject({
      method: "POST",
      url: `/api/issues/${targetKey}/triage/preview`,
      headers: authHeader(scopedToken),
      payload: { phase: "prepare", scope: { kind: "workspace", workspaceId } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().candidates).not.toHaveLength(0);
    expect(response.json().candidates.every((candidate: { issueKey: string }) =>
      !candidate.issueKey.startsWith(`${foreign.key}-`),
    )).toBe(true);
  });

  it("persists once and deduplicates an exact retry without mutating the issue", async () => {
    const preview = (await prepare()).json();
    const issueBefore = await prisma.issue.findUniqueOrThrow({ where: { key: targetKey } });
    const request = {
      method: "POST" as const,
      url: `/api/issues/${targetKey}/triage-proposals`,
      headers: authHeader(token),
      payload: {
        preview,
        previewSeal: preview.previewSeal,
        retainedItemIds: [preview.recommendations[0].itemId, preview.candidates[0].issueId],
      },
    };

    const created = await app.inject(request);
    const retried = await app.inject({
      ...request,
      payload: {
        ...request.payload,
        retainedItemIds: [...request.payload.retainedItemIds].reverse(),
      },
    });

    expect(created.statusCode).toBe(201);
    expect(retried.statusCode).toBe(200);
    expect(retried.json()).toMatchObject({ id: created.json().id, outcome: "deduplicated" });
    const compact = await app.inject({
      method: "GET",
      url: `/api/triage-proposals/${created.json().id}?format=compact`,
      headers: authHeader(token),
    });
    const listed = await app.inject({
      method: "GET",
      url: `/api/projects/${preview.target.projectKey}/triage-proposals?targetIssueKey=${targetKey}&generatorSource=deterministic_policy&degraded=false`,
      headers: authHeader(token),
    });
    expect(compact.statusCode).toBe(200);
    expect(compact.json().content).toBeNull();
    expect(listed.statusCode).toBe(200);
    expect(listed.json().rows).toEqual([
      expect.objectContaining({
        id: created.json().id,
        lifecycle: "current",
        listSummary: expect.objectContaining({
          actionKinds: ["urgency"],
          policy: preview.policy,
          confidenceBands: ["high", "medium"],
          degradationCategories: [],
        }),
      }),
    ]);
    await expect(prisma.triageProposal.count()).resolves.toBe(1);
    await expect(prisma.triageProposalContent.count()).resolves.toBe(1);
    const persisted = await prisma.triageProposal.findUniqueOrThrow({
      where: { id: created.json().id },
      include: { content: true },
    });
    expect(persisted).toMatchObject({ capturedRetentionDays: 30, capturedPolicyVersion: "triage-policy.v1" });
    expect(persisted.retentionEligibleAt.getTime() - persisted.createdAt.getTime()).toBe(30 * 86_400_000);
    expect(persisted.content?.payload).toMatchObject({
      provenance: { sourceSnapshots: { target: { issueId: preview.target.issueId } } },
    });
    await expect(prisma.issue.findUniqueOrThrow({ where: { key: targetKey } })).resolves.toEqual(
      issueBefore,
    );
  });

  it("deduplicates concurrent exact persistence", async () => {
    const preview = (await prepare()).json();
    const request = {
      method: "POST" as const,
      url: `/api/issues/${targetKey}/triage-proposals`,
      headers: authHeader(token),
      payload: { preview, previewSeal: preview.previewSeal },
    };

    const responses = await raceProposalWrites(() => Promise.all([app.inject(request), app.inject(request)]));

    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 201]);
    expect(responses[0].json().id).toBe(responses[1].json().id);
    await expect(prisma.triageProposal.count()).resolves.toBe(1);
  });

  it("rejects stale preview persistence before creating ledger rows", async () => {
    const preview = (await prepare()).json();
    await prisma.issue.update({ where: { key: targetKey }, data: { title: "Changed source" } });

    const response = await app.inject({
      method: "POST",
      url: `/api/issues/${targetKey}/triage-proposals`,
      headers: authHeader(token),
      payload: { preview, previewSeal: preview.previewSeal },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("SOURCE_CONFLICT");
    await expect(prisma.triageProposal.count()).resolves.toBe(0);
  });

  it("rejects tampered preview bytes before creating ledger rows", async () => {
    const preview = (await prepare()).json();
    preview.recommendations[0].normalized.value = "low";

    const response = await app.inject({
      method: "POST",
      url: `/api/issues/${targetKey}/triage-proposals`,
      headers: authHeader(token),
      payload: { preview, previewSeal: preview.previewSeal },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("INVALID_PREVIEW_SEAL");
    await expect(prisma.triageProposal.count()).resolves.toBe(0);
  });

  it("rejects persistence after the workspace policy changes", async () => {
    const preview = (await prepare()).json();
    await prisma.triagePolicy.create({
      data: {
        workspaceId,
        version: "triage-policy.v2",
        createdAt: new Date(Date.now() + 1000),
      },
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/issues/${targetKey}/triage-proposals`,
      headers: authHeader(token),
      payload: { preview, previewSeal: preview.previewSeal },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("POLICY_CONFLICT");
    await expect(prisma.triageProposal.count()).resolves.toBe(0);
  });

  it("deduplicates self-supersession and allows only one distinct correction", async () => {
    const firstPreview = (await prepare()).json();
    const first = await app.inject({
      method: "POST",
      url: `/api/issues/${targetKey}/triage-proposals`,
      headers: authHeader(token),
      payload: { preview: firstPreview, previewSeal: firstPreview.previewSeal },
    });
    const self = await app.inject({
      method: "POST",
      url: `/api/issues/${targetKey}/triage-proposals`,
      headers: authHeader(token),
      payload: {
        preview: firstPreview,
        previewSeal: firstPreview.previewSeal,
        supersedesId: first.json().id,
      },
    });
    expect(self.statusCode).toBe(200);
    expect(self.json()).toMatchObject({ id: first.json().id, outcome: "deduplicated" });

    await prisma.issue.update({ where: { key: targetKey }, data: { priority: "low" } });
    const secondPreview = (await prepare()).json();
    const correction = await app.inject({
      method: "POST",
      url: `/api/issues/${targetKey}/triage-proposals`,
      headers: authHeader(token),
      payload: {
        preview: secondPreview,
        previewSeal: secondPreview.previewSeal,
        supersedesId: first.json().id,
      },
    });
    const retried = await app.inject({
      method: "POST",
      url: `/api/issues/${targetKey}/triage-proposals`,
      headers: authHeader(token),
      payload: {
        preview: secondPreview,
        previewSeal: secondPreview.previewSeal,
        supersedesId: first.json().id,
      },
    });
    expect(correction.statusCode).toBe(201);
    expect(retried.json()).toMatchObject({ id: correction.json().id, outcome: "deduplicated" });

    await prisma.issue.update({ where: { key: targetKey }, data: { priority: "medium" } });
    const thirdPreview = (await prepare()).json();
    const conflict = await app.inject({
      method: "POST",
      url: `/api/issues/${targetKey}/triage-proposals`,
      headers: authHeader(token),
      payload: {
        preview: thirdPreview,
        previewSeal: thirdPreview.previewSeal,
        supersedesId: first.json().id,
      },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().code).toBe("SUPERSESSION_CONFLICT");
    await expect(prisma.triageProposal.count()).resolves.toBe(2);
  });

  it("allows one winner when distinct corrections race", async () => {
    const firstPreview = (await prepare()).json();
    const first = await app.inject({
      method: "POST",
      url: `/api/issues/${targetKey}/triage-proposals`,
      headers: authHeader(token),
      payload: { preview: firstPreview, previewSeal: firstPreview.previewSeal },
    });
    await prisma.issue.update({ where: { key: targetKey }, data: { priority: "low" } });
    const prepared = await Promise.all([prepare("host_assisted"), prepare("host_assisted")]);
    const validate = async (source: (typeof prepared)[number], concept: "impact" | "severity") => {
      const preview = source.json();
      const response = await app.inject({
        method: "POST",
        url: `/api/issues/${targetKey}/triage/preview`,
        headers: authHeader(token),
        payload: {
          phase: "validate",
          contextToken: preview.contextToken,
          hostOutcome: {
            status: "completed",
            provider: "test",
            model: "test-model",
            modelVersion: "1",
          },
          suggestions: [{
            concept,
            value: concept === "impact" ? "customer-facing" : "critical",
            reason: `Distinct ${concept} correction`,
            evidenceRefIds: [preview.recommendations[0].evidence[0].evidenceRefId],
            confidence: "medium",
            confidenceBasis: "Target priority evidence",
          }],
        },
      });
      return response.json();
    };
    const [impactPreview, severityPreview] = await Promise.all([
      validate(prepared[0], "impact"),
      validate(prepared[1], "severity"),
    ]);

    const payload = (preview: typeof impactPreview) => ({
      preview,
      previewSeal: preview.previewSeal,
      supersedesId: first.json().id,
    });
    const responses = await raceProposalWrites(() => Promise.all([
      app.inject({
        method: "POST",
        url: `/api/issues/${targetKey}/triage-proposals`,
        headers: authHeader(token),
        payload: payload(impactPreview),
      }),
      app.inject({
        method: "POST",
        url: `/api/issues/${targetKey}/triage-proposals`,
        headers: authHeader(token),
        payload: payload(severityPreview),
      }),
    ]), first.json().id);

    expect(responses.filter((response) => response.statusCode === 201)).toHaveLength(1);
    expect(responses.filter((response) => response.statusCode === 409)).toHaveLength(1);
    expect(responses.find((response) => response.statusCode === 409)?.json().code).toBe("SUPERSESSION_CONFLICT");
    await expect(prisma.triageProposal.count({ where: { supersedesId: first.json().id } })).resolves.toBe(1);
  });

  it("revalidates candidates used only as retained recommendation evidence", async () => {
    const prepared = (await prepare("host_assisted")).json();
    const candidateEvidence = prepared.candidates[0].evidence[0];
    const validated = await app.inject({
      method: "POST",
      url: `/api/issues/${targetKey}/triage/preview`,
      headers: authHeader(token),
      payload: {
        phase: "validate",
        contextToken: prepared.contextToken,
        hostOutcome: {
          status: "completed",
          provider: "test",
          model: "test-model",
          modelVersion: "1",
        },
        suggestions: [{
          concept: "impact",
          value: "customer-facing",
          reason: "Candidate evidence supports the recommendation",
          evidenceRefIds: [candidateEvidence.evidenceRefId],
          confidence: "medium",
          confidenceBasis: "Candidate title evidence",
        }],
      },
    });
    const preview = validated.json();
    const hostItem = preview.recommendations.find(
      (recommendation: { source: string }) => recommendation.source === "host_ai",
    );
    await prisma.issue.update({
      where: { id: prepared.candidates[0].issueId },
      data: { title: "Candidate changed after validation" },
    });

    const persisted = await app.inject({
      method: "POST",
      url: `/api/issues/${targetKey}/triage-proposals`,
      headers: authHeader(token),
      payload: {
        preview,
        previewSeal: preview.previewSeal,
        retainedItemIds: [hostItem.itemId],
      },
    });

    expect(persisted.statusCode).toBe(409);
    expect(persisted.json().code).toBe("SOURCE_CONFLICT");
    await expect(prisma.triageProposal.count()).resolves.toBe(0);
  });

  it("does not persist candidates removed from the retained set", async () => {
    const preview = (await prepare()).json();
    const candidate = preview.candidates[0];
    const created = await app.inject({
      method: "POST",
      url: `/api/issues/${targetKey}/triage-proposals`,
      headers: authHeader(token),
      payload: {
        preview,
        previewSeal: preview.previewSeal,
        retainedItemIds: [preview.recommendations[0].itemId],
      },
    });

    expect(created.statusCode).toBe(201);
    const content = await prisma.triageProposalContent.findUniqueOrThrow({
      where: { proposalId: created.json().id },
    });
    expect(JSON.stringify(content)).not.toContain(candidate.issueId);
    expect(JSON.stringify(content)).not.toContain(candidate.issueKey);
  });

  it("redacts inaccessible candidate data without hiding authorized proposal content", async () => {
    const foreign = await seedTestProject(workspaceId, `F${randomUUID().slice(0, 4)}`);
    await prisma.projectMember.create({
      data: { projectId: foreign.id, userId, role: "member" },
    });
    const foreignCandidate = await prisma.issue.create({
      data: {
        projectId: foreign.id,
        key: `${foreign.key}-1`,
        sequenceNum: 1,
        title: "Login failure cross-project candidate",
      },
    });
    const previewResponse = await app.inject({
      method: "POST",
      url: `/api/issues/${targetKey}/triage/preview`,
      headers: authHeader(token),
      payload: {
        phase: "prepare",
        aiIntent: "host_assisted",
        scope: { kind: "workspace", workspaceId },
      },
    });
    const prepared = previewResponse.json();
    const candidate = prepared.candidates.find(
      (item: { issueId: string }) => item.issueId === foreignCandidate.id,
    );
    const validated = await app.inject({
      method: "POST",
      url: `/api/issues/${targetKey}/triage/preview`,
      headers: authHeader(token),
      payload: {
        phase: "validate",
        contextToken: prepared.contextToken,
        hostOutcome: {
          status: "completed",
          provider: "test",
          model: "test-model",
          modelVersion: "1",
        },
        suggestions: [{
          concept: "impact",
          value: "foreign-candidate-derived-value",
          reason: "Foreign candidate evidence",
          evidenceRefIds: [candidate.evidence[0].evidenceRefId],
          confidence: "medium",
          confidenceBasis: "Candidate title evidence",
        }],
      },
    });
    const preview = validated.json();
    const created = await app.inject({
      method: "POST",
      url: `/api/issues/${targetKey}/triage-proposals`,
      headers: authHeader(token),
      payload: {
        preview,
        previewSeal: preview.previewSeal,
        retainedItemIds: [preview.recommendations[0].itemId, "host:1"],
      },
    });
    expect(created.statusCode).toBe(201);
    await prisma.projectMember.delete({
      where: { userId_projectId: { userId, projectId: foreign.id } },
    });

    const full = await app.inject({
      method: "GET",
      url: `/api/triage-proposals/${created.json().id}?format=full`,
      headers: authHeader(token),
    });
    const compact = await app.inject({
      method: "GET",
      url: `/api/triage-proposals/${created.json().id}?format=compact`,
      headers: authHeader(token),
    });

    expect(full.statusCode).toBe(200);
    expect(full.json().content).not.toBeNull();
    expect(JSON.stringify(full.json().content)).not.toContain(foreignCandidate.id);
    expect(JSON.stringify(full.json().content)).not.toContain(`${foreign.key}-1`);
    expect(JSON.stringify(full.json().content)).not.toContain(foreignCandidate.title);
    expect(JSON.stringify(full.json().content)).not.toContain("foreign-candidate-derived-value");
    expect(full.json().content.payload.normalizedPayload.actions).not.toHaveLength(0);
    expect(full.json().redacted).toBeUndefined();
    expect(full.json().listSummary.candidateCount).toBeUndefined();
    expect(compact.statusCode).toBe(200);
    expect(compact.json().listSummary.candidateCount).toBeUndefined();
  });
});

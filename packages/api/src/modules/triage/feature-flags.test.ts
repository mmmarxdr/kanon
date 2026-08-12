import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

const flags = [
  "TRIAGE_SEARCH_ENABLED",
  "TRIAGE_PREVIEW_ENABLED",
  "TRIAGE_PROPOSAL_READS_ENABLED",
  "TRIAGE_PROPOSALS_ENABLED",
  "TRIAGE_DISMISS_ENABLED",
  "TRIAGE_RETENTION_ENABLED",
] as const;
describe("triage feature flags", () => {
  let app: FastifyInstance | undefined;
  let helpers: typeof import("../../test/helpers.js") | undefined;
  async function closeApp() {
    await app?.close();
    await helpers?.disconnectTestDb();
    app = undefined;
    helpers = undefined;
  }

  async function setup(
    disabled: (typeof flags)[number],
    retentionRegister?: typeof import("./retention.js").registerRetentionHousekeeping,
  ) {
    await closeApp();
    for (const flag of flags) process.env[flag] = flag === disabled ? "false" : "true";
    vi.resetModules();
    helpers = await import("../../test/helpers.js");
    const { prisma } = await import("../../config/prisma.js");
    await helpers.cleanDatabase();
    const workspace = await helpers.seedTestWorkspace();
    const member = await helpers.seedTestMember(workspace.id);
    const project = await helpers.seedTestProject(workspace.id);
    await prisma.projectMember.create({ data: { projectId: project.id, userId: member.userId, role: "member" } });
    await prisma.triagePolicy.create({ data: { workspaceId: workspace.id, version: "v1" } });
    const target = await prisma.issue.create({
      data: { projectId: project.id, key: `${project.key}-1`, sequenceNum: 1, title: "Flag target" },
    });
    const done = await prisma.issue.create({
      data: { projectId: project.id, key: `${project.key}-2`, sequenceNum: 2, title: "Flag history", state: "done" },
    });
    app = await helpers.createTestApp({ retentionRegister });
    const headers = helpers.authHeader(member.token);
    const request = (method: "GET" | "POST", url: string, payload?: unknown) =>
      app!.inject({ method, url, headers, ...(payload === undefined ? {} : { payload }) });
    const preview = () => request("POST", `/api/issues/${target.key}/triage/preview`, { phase: "prepare" });
    return {
      preview,
      search: () => request("POST", `/api/workspaces/${workspace.id}/issue-search.v1`, {
        q: "flag", scope: { kind: "workspace", workspaceId: workspace.id },
      }),
      reads: () => Promise.all([
        request("GET", `/api/projects/${project.key}/triage-proposals`),
        request("GET", "/api/triage-proposals/00000000-0000-4000-8000-000000000000"),
        request("GET", `/api/issues/${done.key}/triage-history`),
      ]),
      persist: async () => {
        const prepared = await preview();
        expect(prepared.statusCode).toBe(200);
        return request("POST", `/api/issues/${target.key}/triage-proposals`, {
          preview: prepared.json(), previewSeal: prepared.json().previewSeal,
        });
      },
      dismiss: () => request("POST", "/api/triage-proposals/00000000-0000-4000-8000-000000000000/dismiss", { reason: "disabled" }),
    };
  }

  function expectDisabled(responses: Awaited<ReturnType<FastifyInstance["inject"]>>[]) {
    expect(responses.map((response) => response.statusCode)).toEqual(responses.map(() => 503));
    expect(responses.map((response) => response.json().code)).toEqual(
      responses.map(() => "CAPABILITY_DISABLED"),
    );
  }

  afterEach(async () => {
    await closeApp();
    for (const flag of flags) process.env[flag] = "true";
  });

  it("guards each capability independently", async () => {
    let routes = await setup("TRIAGE_SEARCH_ENABLED");
    expectDisabled([await routes.search()]);
    expect((await routes.preview()).statusCode).toBe(200);

    routes = await setup("TRIAGE_PREVIEW_ENABLED");
    expectDisabled([await routes.preview()]);
    expect((await routes.search()).statusCode).toBe(200);

    routes = await setup("TRIAGE_PROPOSAL_READS_ENABLED");
    expectDisabled(await routes.reads());
    expect((await routes.preview()).statusCode).toBe(200);

    routes = await setup("TRIAGE_PROPOSALS_ENABLED");
    expectDisabled([await routes.persist()]);
    expect((await routes.dismiss()).statusCode).not.toBe(503);

    routes = await setup("TRIAGE_DISMISS_ENABLED");
    expectDisabled([await routes.dismiss()]);
    expect((await routes.persist()).statusCode).toBe(201);
  });

  it("registers retention only when its last-stage flag is enabled", async () => {
    const disabledRegister = vi.fn(() => vi.fn());
    await setup("TRIAGE_RETENTION_ENABLED", disabledRegister);
    expect(disabledRegister).not.toHaveBeenCalled();

    const enabledRegister = vi.fn(() => vi.fn());
    await setup("TRIAGE_SEARCH_ENABLED", enabledRegister);
    expect(enabledRegister).toHaveBeenCalledOnce();
  });
});

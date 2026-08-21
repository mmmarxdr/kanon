import { AppError } from "../../shared/types.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./service.js", () => ({
  heartbeat: vi.fn(),
  startWork: vi.fn(),
  stopWork: vi.fn(),
  recordInterruption: vi.fn(),
  getActiveWorkers: vi.fn(),
}));

vi.mock("../../config/prisma.js", () => ({
  prisma: {
    workCaptureIntent: { findUnique: vi.fn(), findMany: vi.fn() },
    domainEventOutbox: { findUnique: vi.fn() },
  },
}));

vi.mock("./capture-intent-effect.js", () => ({
  requestWorkCaptureIntentEffect: vi.fn(),
}));

vi.mock("../../services/event-bus/outbox.js", () => ({
  publishDomainEventByDeliveryKey: vi.fn(),
}));

import type { FastifyInstance } from "fastify";
import { prisma } from "../../config/prisma.js";
import { publishDomainEventByDeliveryKey } from "../../services/event-bus/outbox.js";
import { requestWorkCaptureIntentEffect } from "./capture-intent-effect.js";
import workSessionRoutes from "./routes.js";
import * as workSessionService from "./service.js";

const command = {
  commandId: "11111111-1111-4111-8111-111111111111",
  epoch: "22222222-2222-4222-8222-222222222222",
  leaseGeneration: 2,
} as const;
const ownerCommand = {
  ...command,
  ownerId: "33333333-3333-4333-8333-333333333333",
} as const;
const intent = {
  id: "intent-internal",
  epoch: command.epoch,
  leaseGeneration: command.leaseGeneration,
  state: "capturing",
  memberId: "member-1",
};
const deliveryKey = `work-capture.intent-effect:v1:${command.commandId}`;

type Handler = (request: any, reply: any) => Promise<unknown>;
const routeOptions = new Map<string, any>();

async function registeredHandlers() {
  const handlers = new Map<string, Handler>();
  routeOptions.clear();
  const app = {
    withTypeProvider: () => app,
    post: (path: string, options: unknown, handler: Handler) => {
      routeOptions.set(`POST ${path}`, options);
      handlers.set(`POST ${path}`, handler);
    },
    delete: (path: string, options: unknown, handler: Handler) => {
      routeOptions.set(`DELETE ${path}`, options);
      handlers.set(`DELETE ${path}`, handler);
    },
    get: (path: string, options: unknown, handler: Handler) => {
      routeOptions.set(`GET ${path}`, options);
      handlers.set(`GET ${path}`, handler);
    },
  } as unknown as FastifyInstance;
  await workSessionRoutes(app);
  return handlers;
}

function request(body?: unknown, userId = "user-1") {
  return {
    params: { key: "KAN-42" },
    body,
    query: {},
    issueId: "issue-1",
    member: { id: "member-1" },
    user: { userId },
    via: "claude-code",
    log: { error: vi.fn() },
  };
}

async function invoke(handler: Handler, routeRequest: ReturnType<typeof request>) {
  const response: { status?: number; body?: unknown } = {};
  const reply = {
    status: vi.fn((status: number) => {
      response.status = status;
      return reply;
    }),
    send: vi.fn((body: unknown) => {
      response.body = body;
      return body;
    }),
  };
  const returned = await handler(routeRequest, reply);
  return { status: response.status ?? 200, body: response.body ?? returned };
}

function effectAccepted() {
  vi.mocked(requestWorkCaptureIntentEffect).mockResolvedValue({
    commandId: command.commandId,
    deliveryKey,
    laneKey: "work-session:issue-1:user-1",
    effectRevision: 1,
  });
}

describe("work-capture public adapter", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(prisma.workCaptureIntent.findUnique).mockResolvedValue(intent as any);
    vi.mocked(prisma.domainEventOutbox.findUnique).mockResolvedValue({
      acknowledgedAt: null,
    } as any);
    vi.mocked(publishDomainEventByDeliveryKey).mockResolvedValue(true);
    effectAccepted();
  });

  it("keeps the start response and adds a principal-scoped capture snapshot", async () => {
    vi.mocked(workSessionService.startWork).mockResolvedValue({
      session: { id: "session-1" },
      warnings: [],
      autoAssigned: false,
    } as any);
    const handlers = await registeredHandlers();
    const handler = handlers.get("POST /issues/:key/work-sessions");
    if (!handler) throw new Error("start route not registered");

    const result = await invoke(handler, request({ source: "mcp" }));

    expect(result).toEqual({
      status: 201,
      body: {
        session: { id: "session-1" },
        warnings: [],
        autoAssigned: false,
        captureIntent: {
          epoch: command.epoch,
          leaseGeneration: 2,
          state: "capturing",
        },
      },
    });
    expect(prisma.workCaptureIntent.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_issueId: { userId: "user-1", issueId: "issue-1" } },
      })
    );
    expect(workSessionService.startWork).toHaveBeenCalledWith(
      "KAN-42",
      "member-1",
      "user-1",
      "mcp",
      "claude-code",
      expect.anything()
    );
  });

  it("forwards authenticated identity and normalized client provenance", async () => {
    vi.mocked(workSessionService.heartbeat).mockResolvedValue({ id: "session-1" } as any);
    const handlers = await registeredHandlers();
    const handler = handlers.get("POST /issues/:key/work-sessions/heartbeat");
    if (!handler) throw new Error("heartbeat route not registered");
    expect(
      routeOptions.get("POST /issues/:key/work-sessions/heartbeat")?.schema.body
    ).toBeUndefined();

    await invoke(handler, request());

    expect(workSessionService.heartbeat).toHaveBeenCalledWith(
      "KAN-42",
      "member-1",
      "user-1",
      "claude-code"
    );
  });

  it.each([undefined, {}])("keeps bodyless and empty heartbeat synchronous", async (body) => {
    vi.mocked(workSessionService.heartbeat).mockResolvedValue({ id: "session-1" } as any);
    const handlers = await registeredHandlers();
    const handler = handlers.get("POST /issues/:key/work-sessions/heartbeat");
    if (!handler) throw new Error("heartbeat route not registered");

    const result = await invoke(handler, request(body));

    expect(workSessionService.heartbeat).toHaveBeenCalledWith(
      "KAN-42",
      "member-1",
      "user-1",
      "claude-code"
    );
    expect(requestWorkCaptureIntentEffect).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 200,
      body: {
        ok: true,
        captureIntent: {
          epoch: command.epoch,
          leaseGeneration: 2,
          state: "capturing",
        },
      },
    });
  });

  it("rejects partial and unknown heartbeat bodies as validation errors", async () => {
    const handlers = await registeredHandlers();
    const handler = handlers.get("POST /issues/:key/work-sessions/heartbeat");
    if (!handler) throw new Error("heartbeat route not registered");

    await expect(invoke(handler, request({ commandId: command.commandId }))).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(invoke(handler, request({ unexpected: true }))).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(workSessionService.heartbeat).not.toHaveBeenCalled();
  });

  it("requires a complete strict command for release and close", async () => {
    const handlers = await registeredHandlers();
    for (const path of [
      "POST /issues/:key/work-captures/release",
      "POST /issues/:key/work-captures/close",
    ]) {
      const handler = handlers.get(path);
      if (!handler) throw new Error(`${path} not registered`);
      await expect(
        invoke(handler, request({ commandId: command.commandId }))
      ).rejects.toMatchObject({
        statusCode: 400,
      });
      await expect(
        invoke(handler, request({ ...command, observedAt: new Date().toISOString() }))
      ).rejects.toMatchObject({ statusCode: 400 });
      await expect(
        invoke(handler, request({ ...command, unexpected: true }))
      ).rejects.toMatchObject({ statusCode: 400 });
    }
    expect(requestWorkCaptureIntentEffect).not.toHaveBeenCalled();
  });

  it("maps a full heartbeat command to durable activity", async () => {
    const handlers = await registeredHandlers();
    const handler = handlers.get("POST /issues/:key/work-sessions/heartbeat");
    if (!handler) throw new Error("heartbeat route not registered");

    const result = await invoke(handler, request(command));

    expect(workSessionService.heartbeat).not.toHaveBeenCalled();
    expect(requestWorkCaptureIntentEffect).toHaveBeenCalledWith({
      commandId: command.commandId,
      intentId: intent.id,
      epoch: command.epoch,
      leaseGeneration: command.leaseGeneration,
      kind: "activity",
      ownerKind: "implicit",
    });
    expect(publishDomainEventByDeliveryKey).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      status: 200,
      body: { ok: true, commandId: command.commandId, deliveryStatus: "acknowledged" },
    });
  });

  it("maps an owner-scoped Web heartbeat without weakening the required owner contract", async () => {
    const handlers = await registeredHandlers();
    const handler = handlers.get("POST /issues/:key/work-sessions/heartbeat");
    if (!handler) throw new Error("heartbeat route not registered");

    await invoke(handler, { ...request(ownerCommand), via: "web" });

    expect(requestWorkCaptureIntentEffect).toHaveBeenCalledWith({
      commandId: ownerCommand.commandId,
      intentId: intent.id,
      epoch: ownerCommand.epoch,
      leaseGeneration: ownerCommand.leaseGeneration,
      kind: "activity",
      ownerId: ownerCommand.ownerId,
      ownerKind: "web",
    });

    await expect(
      invoke(handler, {
        ...request({ ...command, ownerId: undefined }),
        via: "web",
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("keeps the strict legacy command on its implicit compatibility anchor", async () => {
    const handlers = await registeredHandlers();
    const handler = handlers.get("POST /issues/:key/work-sessions/heartbeat");
    if (!handler) throw new Error("heartbeat route not registered");

    await invoke(handler, request(command));

    expect(requestWorkCaptureIntentEffect).toHaveBeenCalledWith({
      commandId: command.commandId,
      intentId: intent.id,
      epoch: command.epoch,
      leaseGeneration: command.leaseGeneration,
      kind: "activity",
      ownerKind: "implicit",
    });
  });

  it.each([
    ["release", "/issues/:key/work-captures/release"],
    ["close", "/issues/:key/work-captures/close"],
  ] as const)("maps %s to the exact durable effect kind", async (kind, path) => {
    const handlers = await registeredHandlers();
    const handler = handlers.get(`POST ${path}`);
    if (!handler) throw new Error(`${kind} route not registered`);

    await invoke(handler, request(command));

    expect(requestWorkCaptureIntentEffect).toHaveBeenCalledWith(
      expect.objectContaining({ intentId: intent.id, kind })
    );
  });

  it("never resolves another user's intent", async () => {
    vi.mocked(prisma.workCaptureIntent.findUnique).mockImplementation(async ({ where }: any) =>
      where.userId_issueId.userId === "user-1" ? (intent as any) : null
    );
    const handlers = await registeredHandlers();
    const handler = handlers.get("POST /issues/:key/work-captures/release");
    if (!handler) throw new Error("release route not registered");

    await expect(invoke(handler, request(command, "user-2"))).rejects.toMatchObject({
      statusCode: 404,
      code: "CAPTURE_INTENT_NOT_FOUND",
    });
    expect(requestWorkCaptureIntentEffect).not.toHaveBeenCalled();
  });

  it("never accepts an intent owned by another authenticated member", async () => {
    vi.mocked(prisma.workCaptureIntent.findUnique).mockResolvedValue({
      ...intent,
      memberId: "member-2",
    } as any);
    const handlers = await registeredHandlers();
    const handler = handlers.get("POST /issues/:key/work-captures/release");
    if (!handler) throw new Error("release route not registered");

    await expect(invoke(handler, request(command))).rejects.toMatchObject({
      statusCode: 404,
      code: "CAPTURE_INTENT_NOT_FOUND",
    });
    expect(requestWorkCaptureIntentEffect).not.toHaveBeenCalled();
  });

  it.each([
    [true, null, 200, "acknowledged"],
    [false, null, 202, "pending"],
    [false, new Date("2026-08-18T16:01:00.000Z"), 200, "acknowledged"],
  ] as const)(
    "maps delivery=%s acknowledgedAt=%s to HTTP %s %s",
    async (delivered, acknowledgedAt, status, deliveryStatus) => {
      vi.mocked(publishDomainEventByDeliveryKey).mockResolvedValue(delivered);
      vi.mocked(prisma.domainEventOutbox.findUnique).mockResolvedValue({ acknowledgedAt } as any);
      const handlers = await registeredHandlers();
      const handler = handlers.get("POST /issues/:key/work-captures/release");
      if (!handler) throw new Error("release route not registered");

      const result = await invoke(handler, request(command));

      expect(result).toMatchObject({ status, body: { deliveryStatus } });
      expect(publishDomainEventByDeliveryKey).toHaveBeenCalledTimes(1);
    }
  );

  it("returns pending when delivery throws after durable acceptance", async () => {
    vi.mocked(publishDomainEventByDeliveryKey).mockRejectedValue(new Error("listener offline"));
    const handlers = await registeredHandlers();
    const handler = handlers.get("POST /issues/:key/work-captures/close");
    if (!handler) throw new Error("close route not registered");
    const routeRequest = request(command);

    const result = await invoke(handler, routeRequest);

    expect(result).toMatchObject({ status: 202, body: { deliveryStatus: "pending" } });
    expect(routeRequest.log.error).toHaveBeenCalledOnce();
  });

  it("returns pending when acknowledgement status cannot be read", async () => {
    vi.mocked(publishDomainEventByDeliveryKey).mockResolvedValue(false);
    vi.mocked(prisma.domainEventOutbox.findUnique).mockRejectedValue(new Error("status offline"));
    const handlers = await registeredHandlers();
    const handler = handlers.get("POST /issues/:key/work-captures/release");
    if (!handler) throw new Error("release route not registered");

    const routeRequest = request(command);
    const result = await invoke(handler, routeRequest);

    expect(result).toMatchObject({ status: 202, body: { deliveryStatus: "pending" } });
    expect(routeRequest.log.error).toHaveBeenCalledOnce();
  });

  it("uses null only as a defensive snapshot fallback after start commits", async () => {
    vi.mocked(workSessionService.startWork).mockResolvedValue({
      session: { id: "session-1" },
      warnings: [],
      autoAssigned: false,
    } as any);
    vi.mocked(prisma.workCaptureIntent.findUnique).mockRejectedValue(new Error("snapshot offline"));
    const handlers = await registeredHandlers();
    const handler = handlers.get("POST /issues/:key/work-sessions");
    if (!handler) throw new Error("start route not registered");
    const routeRequest = request({ source: "mcp" });

    const result = await invoke(handler, routeRequest);

    expect(result).toMatchObject({ status: 201, body: { captureIntent: null } });
    expect(routeRequest.log.error).toHaveBeenCalledOnce();
  });

  it.each([
    ["heartbeat", "POST /issues/:key/work-sessions/heartbeat"],
    ["release", "POST /issues/:key/work-captures/release"],
    ["close", "POST /issues/:key/work-captures/close"],
  ] as const)("sanitizes unknown durable %s producer failures", async (operation, path) => {
    vi.mocked(requestWorkCaptureIntentEffect).mockRejectedValue(new Error("database password"));
    const handlers = await registeredHandlers();
    const handler = handlers.get(path);
    if (!handler) throw new Error(`${operation} route not registered`);

    await expect(invoke(handler, request(command))).rejects.toMatchObject({
      statusCode: 503,
      code: "WORK_CAPTURE_RETRYABLE",
      message: "Work capture is temporarily unavailable",
      details: { retryable: true, operation, commandId: command.commandId },
    });
  });

  it.each([
    ["start", "startWork", "POST /issues/:key/work-sessions"],
    ["heartbeat", "heartbeat", "POST /issues/:key/work-sessions/heartbeat"],
  ] as const)("preserves unknown legacy %s failures", async (operation, method, path) => {
    const failure = new Error(`${operation} failed after commit`);
    vi.mocked(workSessionService[method]).mockRejectedValue(failure);
    const handlers = await registeredHandlers();
    const handler = handlers.get(path);
    if (!handler) throw new Error(`${operation} route not registered`);
    const body = operation === "start" ? { source: "mcp" } : undefined;

    await expect(invoke(handler, request(body))).rejects.toBe(failure);
  });

  it("passes known pre-acceptance AppErrors through unchanged", async () => {
    const conflict = new AppError(409, "CAPTURE_EFFECT_STALE_FENCE", "stale fence");
    vi.mocked(requestWorkCaptureIntentEffect).mockRejectedValue(conflict);
    const handlers = await registeredHandlers();
    const handler = handlers.get("POST /issues/:key/work-captures/close");
    if (!handler) throw new Error("close route not registered");

    await expect(invoke(handler, request(command))).rejects.toBe(conflict);
  });

  it("preserves legacy SESSION_NOT_FOUND heartbeat behavior", async () => {
    vi.mocked(workSessionService.heartbeat).mockResolvedValue(null);
    const handlers = await registeredHandlers();
    const handler = handlers.get("POST /issues/:key/work-sessions/heartbeat");
    if (!handler) throw new Error("heartbeat route not registered");

    await expect(invoke(handler, request())).rejects.toMatchObject({
      statusCode: 404,
      code: "SESSION_NOT_FOUND",
    });
  });

  it("lists only the authenticated principal's scoped nonclosed capture intents", async () => {
    vi.mocked(prisma.workCaptureIntent.findMany).mockResolvedValue([
      {
        id: "55555555-5555-4555-8555-555555555555",
        epoch: command.epoch,
        leaseGeneration: 2,
        state: "capturing",
        issue: { key: "KAN-42" },
      },
    ] as any);
    const handlers = await registeredHandlers();
    const handler = handlers.get("GET /me/work-captures");
    if (!handler) throw new Error("capture hydration route not registered");
    const routeRequest = {
      ...request(),
      user: {
        userId: "11111111-1111-4111-8111-111111111111",
        allowedProjectIds: ["33333333-3333-4333-8333-333333333333"],
      },
      query: {
        workspaceId: "22222222-2222-4222-8222-222222222222",
        limit: 20,
      },
    };

    const result = await invoke(handler, routeRequest as any);

    expect(result.body).toEqual({
      principalId: "11111111-1111-4111-8111-111111111111",
      workspaceId: "22222222-2222-4222-8222-222222222222",
      intents: [
        {
          issueKey: "KAN-42",
          epoch: command.epoch,
          leaseGeneration: 2,
          state: "capturing",
        },
      ],
      nextCursor: null,
    });
    expect(prisma.workCaptureIntent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "11111111-1111-4111-8111-111111111111",
          state: { not: "closed" },
        }),
      })
    );
  });

  it("keeps capture hydration query and response contracts strict", async () => {
    await registeredHandlers();
    const schema = routeOptions.get("GET /me/work-captures")?.schema;
    expect(
      schema.querystring.safeParse({
        workspaceId: "22222222-2222-4222-8222-222222222222",
        limit: 0,
      }).success
    ).toBe(false);
    expect(
      schema.querystring.safeParse({
        workspaceId: "22222222-2222-4222-8222-222222222222",
        limit: 101,
      }).success
    ).toBe(false);
    expect(
      schema.querystring.safeParse({
        workspaceId: "22222222-2222-4222-8222-222222222222",
        cursor: "not-a-uuid",
      }).success
    ).toBe(false);
    expect(
      schema.response[200].safeParse({
        principalId: "11111111-1111-4111-8111-111111111111",
        workspaceId: "22222222-2222-4222-8222-222222222222",
        intents: [
          {
            issueKey: "KAN-42",
            epoch: command.epoch,
            leaseGeneration: 2,
            state: "capturing",
            intentId: "private",
          },
        ],
        nextCursor: null,
      }).success
    ).toBe(false);
  });

  it("rejects capture hydration without an authenticated principal", async () => {
    const handlers = await registeredHandlers();
    const handler = handlers.get("GET /me/work-captures");
    if (!handler) throw new Error("capture hydration route not registered");
    const routeRequest = {
      ...request(),
      user: undefined,
      query: { workspaceId: "22222222-2222-4222-8222-222222222222", limit: 100 },
    };

    await expect(invoke(handler, routeRequest as any)).rejects.toMatchObject({
      statusCode: 401,
      code: "UNAUTHENTICATED",
    });
    expect(prisma.workCaptureIntent.findMany).not.toHaveBeenCalled();
  });
});

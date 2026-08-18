import { describe, expect, it, vi } from "vitest";

vi.mock("./service.js", () => ({
  heartbeat: vi.fn(),
  startWork: vi.fn(),
  stopWork: vi.fn(),
  recordInterruption: vi.fn(),
  getActiveWorkers: vi.fn(),
}));

import type { FastifyInstance } from "fastify";
import workSessionRoutes from "./routes.js";
import * as workSessionService from "./service.js";

describe("work-session heartbeat route", () => {
  it("forwards authenticated identity and normalized client provenance", async () => {
    const handlers = new Map<string, (...args: any[]) => Promise<unknown>>();
    const app = {
      withTypeProvider: () => app,
      post: (
        path: string,
        _options: unknown,
        handler: (...args: any[]) => Promise<unknown>,
      ) => handlers.set(`POST ${path}`, handler),
      delete: vi.fn(),
      get: vi.fn(),
    } as unknown as FastifyInstance;
    vi.mocked(workSessionService.heartbeat).mockResolvedValue({
      id: "session-1",
    } as any);
    await workSessionRoutes(app);

    const handler = handlers.get("POST /issues/:key/work-sessions/heartbeat");
    if (!handler) throw new Error("heartbeat route not registered");
    await handler(
      {
        params: { key: "KAN-42" },
        member: { id: "member-1" },
        user: { userId: "user-1" },
        via: "claude-code",
      },
      {},
    );

    expect(workSessionService.heartbeat).toHaveBeenCalledWith(
      "KAN-42",
      "member-1",
      "user-1",
      "claude-code",
    );
  });
});

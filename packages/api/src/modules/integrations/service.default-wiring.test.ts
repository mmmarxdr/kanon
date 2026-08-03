import { beforeEach, describe, expect, it, vi } from "vitest";

const wiring = vi.hoisted(() => {
  const error = new Error("stop after default remote construction");
  const http = { get: vi.fn().mockRejectedValue(error), post: vi.fn(), put: vi.fn() };
  return {
    allowlist: { "http://redmine.internal.example": ["10.20.30.40"] },
    client: vi.fn(function RedmineHttpClient() {
      return http;
    }),
    error,
  };
});

vi.mock("../../config/env.js", () => ({
  env: { REDMINE_ENDPOINT_ALLOWLIST: wiring.allowlist },
}));

vi.mock("../../config/prisma.js", () => ({
  prisma: {
    user: { findUnique: vi.fn().mockResolvedValue({ isInstanceAdmin: true }) },
    member: {
      findUnique: vi.fn().mockResolvedValue({ id: "member-1", role: "owner" }),
      findFirst: vi.fn().mockResolvedValue({ id: "member-1" }),
    },
    integrationConnection: { findUnique: vi.fn().mockResolvedValue(null) },
    instanceSettings: {
      findUnique: vi.fn().mockResolvedValue({
        redmineBaseUrl: "http://redmine.internal.example",
      }),
    },
  },
}));

vi.mock("./providers/redmine/http-client.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./providers/redmine/http-client.js")>();
  return { ...original, RedmineHttpClient: wiring.client };
});

import { createConnection } from "./service.js";

describe("integration service default Redmine wiring", () => {
  beforeEach(() => wiring.client.mockClear());

  it("passes the env endpoint allowlist to the default HTTP client", async () => {
    await expect(
      createConnection(
        {
          workspaceId: "workspace-1",
          apiKey: "api-key",
        },
        "user-1"
      )
    ).rejects.toMatchObject({ statusCode: 502, code: "REDMINE_CONNECTION_FAILED" });

    expect(wiring.client).toHaveBeenCalledWith("http://redmine.internal.example", "api-key", {
      endpointAllowlist: wiring.allowlist,
    });
  });
});

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
    member: { findUnique: vi.fn().mockResolvedValue({ id: "member-1", role: "owner" }) },
    integrationConnection: { findUnique: vi.fn().mockResolvedValue(null) },
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
          baseUrl: "http://redmine.internal.example",
          apiKey: "api-key",
        },
        "user-1"
      )
    ).rejects.toBe(wiring.error);

    expect(wiring.client).toHaveBeenCalledWith("http://redmine.internal.example", "api-key", {
      endpointAllowlist: wiring.allowlist,
    });
  });
});

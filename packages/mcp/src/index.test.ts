import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  connect: vi.fn(),
  recover: vi.fn(),
}));

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    _registeredTools = {};
    tool = vi.fn();
    connect = fakes.connect;
  },
}));
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: class {},
}));
vi.mock("./kanon-client.js", () => ({ KanonClient: class {} }));
vi.mock("./tools/triage.js", () => ({ isTriageToolsEnabled: () => false }));
vi.mock("./register-tools.js", () => ({ registerKanonTools: vi.fn() }));
vi.mock("./heartbeat.js", () => ({
  getToolActivityPolicy: vi.fn(),
  shutdownAllHeartbeats: vi.fn().mockResolvedValue(undefined),
  wrapHandlerWithActivity: vi.fn((handler) => handler),
}));
vi.mock("./sse-client.js", () => ({
  startSseClient: vi.fn(),
  stopSseClient: vi.fn(),
}));
vi.mock("./instructions.js", () => ({
  DEFERRED_TOOLS: [],
  LEGACY_DEFERRED_TOOLS: [],
  LEGACY_SERVER_INSTRUCTIONS: "",
  SERVER_INSTRUCTIONS: "",
}));
vi.mock("./version.js", () => ({ MCP_VERSION: "test" }));
vi.mock("./kanon-binding.js", () => ({
  findKanonConfig: () => ({ workspaceId: "22222222-2222-4222-8222-222222222222" }),
}));
vi.mock("./client-identity.js", () => ({ resolveClientIdentity: () => undefined }));
vi.mock("./capture-recovery.js", () => ({ recoverWorkCaptures: fakes.recover }));

describe("MCP startup", () => {
  beforeEach(() => {
    vi.resetModules();
    fakes.connect.mockReset().mockResolvedValue(undefined);
    fakes.recover.mockReset();
    vi.stubEnv("KANON_API_URL", "https://api.example.test");
    vi.stubEnv("KANON_API_KEY", "test-key");
    vi.stubEnv("KANON_WORKSPACE_ID", "22222222-2222-4222-8222-222222222222");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("connects all tools when capture recovery fails", async () => {
    const recoveryError = Object.assign(new Error("journal read failed"), { code: "EMFILE" });
    fakes.recover.mockRejectedValueOnce(recoveryError);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    await import("./index.js");

    await vi.waitFor(() => expect(fakes.connect).toHaveBeenCalledOnce());
    expect(log).toHaveBeenCalledWith(
      "[capture-recovery] Startup recovery failed; capture recovery is degraded",
      recoveryError
    );
    expect(exit).not.toHaveBeenCalled();
  });
});

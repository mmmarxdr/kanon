/**
 * G1 — Commander dispatcher routing tests.
 *
 * Tests that:
 *   1. argv[2]==="login"                     → login() called
 *   2. argv[2] starts with kanon://           → deprecation error (non-zero exit, not onboard)
 *   3. KANON_ONBOARD_LINK env set             → onboardFromLink(env-value) called
 *   4. piped stdin starts with kanon://       → onboardFromLink(stdin-line) called
 *   5. flags (--api-url / --api-key)          → cascade resolver called (not onboard/login)
 *   6. no argv[2]                             → cascade resolver called
 *
 * The dispatcher lives in `index.ts` but is extracted to a testable helper so
 * we can call it without triggering process.exit or Commander's parse().
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { dispatch, run } from "./index.js";

// ── Mock onboardFromLink ───────────────────────────────────────────────────────
vi.mock("./onboard.js", () => ({
  onboardFromLink: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock login ────────────────────────────────────────────────────────────────
vi.mock("./login.js", () => ({
  login: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock the cascade resolver (the existing run() function) ──────────────────
// We can't easily mock run() since it's in the same module, but dispatch will
// delegate to a deps-injected callback for the cascade path.

import { onboardFromLink } from "./onboard.js";
import { login } from "./login.js";

describe("Commander dispatcher — dispatch()", () => {
  let cascadeWasCalled: boolean;
  let cascadeDeps: { cascade: () => Promise<void> };

  beforeEach(() => {
    cascadeWasCalled = false;
    cascadeDeps = {
      cascade: async () => {
        cascadeWasCalled = true;
      },
    };
    vi.clearAllMocks();
  });

  // ── Login route ─────────────────────────────────────────────────────────────
  it("routes 'login' arg to login()", async () => {
    await dispatch(
      ["node", "index.js", "login"],
      {},
      cascadeDeps,
      { env: {}, isTTY: true, readStdin: async () => null },
    );

    expect(login).toHaveBeenCalledOnce();
    expect(onboardFromLink).not.toHaveBeenCalled();
    expect(cascadeWasCalled).toBe(false);
  });

  // ── Deprecation on argv kanon:// ────────────────────────────────────────────
  it("emits deprecation error when kanon:// is passed as argv (old contract)", async () => {
    const link = "kanon://server.example.com/onboard?token=abc123.def456.ghi789";

    await expect(
      dispatch(
        ["node", "index.js", link],
        {},
        cascadeDeps,
        { env: {}, isTTY: true, readStdin: async () => null },
      ),
    ).rejects.toThrow(/deprecated/i);

    expect(onboardFromLink).not.toHaveBeenCalled();
    expect(cascadeWasCalled).toBe(false);
  });

  // ── Env link reader ─────────────────────────────────────────────────────────
  it("reads kanon:// link from KANON_ONBOARD_LINK env and calls onboardFromLink", async () => {
    const link = "kanon://server.example.com/onboard?token=env123.def456.ghi789";

    await dispatch(
      ["node", "index.js"],
      {},
      cascadeDeps,
      { env: { KANON_ONBOARD_LINK: link }, isTTY: true, readStdin: async () => null },
    );

    expect(onboardFromLink).toHaveBeenCalledWith(link, expect.anything());
    expect(login).not.toHaveBeenCalled();
    expect(cascadeWasCalled).toBe(false);
  });

  // ── Stdin link reader ───────────────────────────────────────────────────────
  it("reads kanon:// link from piped stdin (isTTY=false) and calls onboardFromLink", async () => {
    const link = "kanon://server.example.com/onboard?token=stdin123.def456.ghi789";

    await dispatch(
      ["node", "index.js"],
      {},
      cascadeDeps,
      { env: {}, isTTY: false, readStdin: async () => link },
    );

    expect(onboardFromLink).toHaveBeenCalledWith(link, expect.anything());
    expect(login).not.toHaveBeenCalled();
    expect(cascadeWasCalled).toBe(false);
  });

  it("falls through to cascade when piped stdin does NOT start with kanon://", async () => {
    await dispatch(
      ["node", "index.js"],
      {},
      cascadeDeps,
      { env: {}, isTTY: false, readStdin: async () => "some random data" },
    );

    expect(cascadeWasCalled).toBe(true);
    expect(onboardFromLink).not.toHaveBeenCalled();
  });

  it("does NOT read stdin when stdin is a TTY (would block)", async () => {
    const readStdin = vi.fn(async () => null);

    await dispatch(
      ["node", "index.js"],
      {},
      cascadeDeps,
      { env: {}, isTTY: true, readStdin },
    );

    expect(readStdin).not.toHaveBeenCalled();
    expect(cascadeWasCalled).toBe(true);
  });

  // ── Env takes priority over stdin ───────────────────────────────────────────
  it("prefers KANON_ONBOARD_LINK env over piped stdin", async () => {
    const envLink = "kanon://env-host/onboard?token=env.aaa.bbb";
    const stdinLink = "kanon://stdin-host/onboard?token=stdin.ccc.ddd";

    await dispatch(
      ["node", "index.js"],
      {},
      cascadeDeps,
      { env: { KANON_ONBOARD_LINK: envLink }, isTTY: false, readStdin: async () => stdinLink },
    );

    expect(onboardFromLink).toHaveBeenCalledWith(envLink, expect.anything());
    expect(onboardFromLink).toHaveBeenCalledTimes(1);
  });

  // ── Cascade routes ──────────────────────────────────────────────────────────
  it("routes --api-url / --api-key flags to cascade resolver", async () => {
    await dispatch(
      ["node", "index.js", "--api-url", "https://api.test", "--api-key", "sk-abc"],
      { apiUrl: "https://api.test", apiKey: "sk-abc" },
      cascadeDeps,
      { env: {}, isTTY: true, readStdin: async () => null },
    );

    expect(cascadeWasCalled).toBe(true);
    expect(onboardFromLink).not.toHaveBeenCalled();
    expect(login).not.toHaveBeenCalled();
  });

  it("routes empty args to cascade resolver (default path)", async () => {
    await dispatch(
      ["node", "index.js"],
      {},
      cascadeDeps,
      { env: {}, isTTY: true, readStdin: async () => null },
    );

    expect(cascadeWasCalled).toBe(true);
    expect(onboardFromLink).not.toHaveBeenCalled();
    expect(login).not.toHaveBeenCalled();
  });
});


// KAN-256 configure-mode seams: all side-effectful collaborators are mocked so
// these tests verify routing and planned arguments without touching user state.
const setupMocks = vi.hoisted(() => ({
  buildPlatformContext: vi.fn(), detectTools: vi.fn(), resolveToolTargets: vi.fn(),
  selectTools: vi.fn(), resolveAuth: vi.fn(), getCredentialStore: vi.fn(),
  resolveWrapperReuse: vi.fn(), resolveNodeBin: vi.fn(), resolveMcpServerPath: vi.fn(),
  buildMcpEntry: vi.fn(), buildWrapperMcpEntry: vi.fn(), installToolSurface: vi.fn(),
  getAssetsDir: vi.fn(), resolveExistingToolWorkspaceId: vi.fn(), cleanupLegacyToolSurface: vi.fn(),
  discoverCursorExecutionPlan: vi.fn(), planCursorSurfaceOutcomes: vi.fn(),
  collectCursorOwnershipByTarget: vi.fn(),
  finalizeCursorSurfaceResults: vi.fn(), discoverCursorSurfaces: vi.fn(),
  removeToolMcpConfig: vi.fn(), removeSkills: vi.fn(), removeTemplate: vi.fn(),
  removeWorkflows: vi.fn(), removeAgents: vi.fn(), removeCommands: vi.fn(),
}));

vi.mock("./detect.js", () => ({ buildPlatformContext: setupMocks.buildPlatformContext }));
vi.mock("./registry.js", () => ({ detectTools: setupMocks.detectTools, resolveToolTargets: setupMocks.resolveToolTargets }));
vi.mock("./tool-selection.js", () => ({ selectTools: setupMocks.selectTools }));
vi.mock("./auth.js", () => ({ resolveAuth: setupMocks.resolveAuth }));
vi.mock("./credential-store/factory.js", () => ({ getCredentialStore: setupMocks.getCredentialStore }));
vi.mock("./wrapper-reuse.js", () => ({ resolveWrapperReuse: setupMocks.resolveWrapperReuse }));
vi.mock("./mcp-config.js", () => ({ buildMcpEntry: setupMocks.buildMcpEntry, buildWrapperMcpEntry: setupMocks.buildWrapperMcpEntry, removeToolMcpConfig: setupMocks.removeToolMcpConfig, resolveMcpServerPath: setupMocks.resolveMcpServerPath, resolveNodeBin: setupMocks.resolveNodeBin }));
vi.mock("./tool-surface.js", () => ({ cleanupLegacyToolSurface: setupMocks.cleanupLegacyToolSurface, getAssetsDir: setupMocks.getAssetsDir, installToolSurface: setupMocks.installToolSurface, resolveExistingToolWorkspaceId: setupMocks.resolveExistingToolWorkspaceId }));
vi.mock("./cursor-plan.js", () => ({ discoverCursorExecutionPlan: setupMocks.discoverCursorExecutionPlan, planCursorSurfaceOutcomes: setupMocks.planCursorSurfaceOutcomes, finalizeCursorSurfaceResults: setupMocks.finalizeCursorSurfaceResults }));
vi.mock("./cursor-inventory.js", () => ({ collectCursorOwnershipByTarget: setupMocks.collectCursorOwnershipByTarget }));
vi.mock("./cursor-surfaces.js", () => ({ discoverCursorSurfaces: setupMocks.discoverCursorSurfaces }));
vi.mock("./skills.js", () => ({ removeSkills: setupMocks.removeSkills }));
vi.mock("./templates.js", () => ({ removeTemplate: setupMocks.removeTemplate }));
vi.mock("./workflows.js", () => ({ removeWorkflows: setupMocks.removeWorkflows }));
vi.mock("./agents.js", () => ({ removeAgents: setupMocks.removeAgents }));
vi.mock("./commands.js", () => ({ removeCommands: setupMocks.removeCommands }));

const localTarget = { config: () => "/home/dev/.cursor/mcp.json", skills: () => "/home/dev/.cursor/skills", mcpMode: "direct" as const };
const windowsTarget = { config: () => "/mnt/c/Users/dev/.cursor/mcp.json", skills: () => "/mnt/c/Users/dev/.cursor/skills", mcpMode: "wsl-bridge" as const };
const cursorTool = { name: "cursor", displayName: "Cursor", rootKey: "mcpServers", clientIdentity: "cursor", platforms: { wsl: localTarget } } as any;

beforeEach(() => {
  vi.resetAllMocks();
  setupMocks.buildPlatformContext.mockResolvedValue({ platform: "wsl", homedir: "/home/dev", winHome: "/mnt/c/Users/dev" });
  setupMocks.getAssetsDir.mockReturnValue("/assets");
  setupMocks.resolveWrapperReuse.mockResolvedValue(undefined);
  setupMocks.resolveNodeBin.mockReturnValue("/usr/bin/node");
  setupMocks.resolveMcpServerPath.mockReturnValue({ path: "/mcp/index.js" });
  setupMocks.buildMcpEntry.mockReturnValue({ command: "node", args: [] });
  setupMocks.buildWrapperMcpEntry.mockReturnValue({ command: "node", args: [] });
  setupMocks.installToolSurface.mockReturnValue([]);
  setupMocks.collectCursorOwnershipByTarget.mockReturnValue({
    [localTarget.config()]: { targetKey: localTarget.config(), configPath: localTarget.config(), state: "missing" },
    [windowsTarget.config()]: { targetKey: windowsTarget.config(), configPath: windowsTarget.config(), state: "missing" },
  });
  setupMocks.planCursorSurfaceOutcomes.mockReturnValue({ results: [], diagnostics: [] });
  setupMocks.finalizeCursorSurfaceResults.mockImplementation((results: unknown) => results);
});

describe("KAN-256 configure mode", () => {
  it("prints a static MCP manual fallback for empty configure detection before auth or runtime work", async () => {
    setupMocks.detectTools.mockResolvedValue([]);
    setupMocks.selectTools.mockResolvedValue([]);
    setupMocks.discoverCursorSurfaces.mockReturnValue([]);
    setupMocks.resolveAuth.mockRejectedValue(new Error("auth must not run"));
    setupMocks.getCredentialStore.mockImplementation(() => { throw new Error("credential store must not run"); });
    setupMocks.resolveNodeBin.mockImplementation(() => { throw new Error("node resolution must not run"); });
    setupMocks.discoverCursorExecutionPlan.mockImplementation(() => { throw new Error("Cursor planning must not run"); });
    setupMocks.installToolSurface.mockImplementation(() => { throw new Error("writer must not run"); });
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      await expect(run({ yes: true })).resolves.toBeUndefined();
      expect(setupMocks.resolveMcpServerPath).toHaveBeenCalledOnce();
      expect(consoleLog).toHaveBeenCalledWith(
        "  To configure Kanon manually, use MCP server: /mcp/index.js",
      );
      expect(setupMocks.getCredentialStore).not.toHaveBeenCalled();
      expect(setupMocks.resolveWrapperReuse).not.toHaveBeenCalled();
      expect(setupMocks.resolveAuth).not.toHaveBeenCalled();
      expect(setupMocks.resolveNodeBin).not.toHaveBeenCalled();
      expect(setupMocks.discoverCursorExecutionPlan).not.toHaveBeenCalled();
      expect(setupMocks.resolveToolTargets).not.toHaveBeenCalled();
      expect(setupMocks.installToolSurface).not.toHaveBeenCalled();
    } finally {
      consoleLog.mockRestore();
    }
  });

  it("fails an explicit absent Cursor selection before credentials or runtime resolution", async () => {
    const invalidSelection = "Cursor is not available for configuration";
    setupMocks.detectTools.mockResolvedValue([cursorTool]);
    setupMocks.selectTools.mockResolvedValue([cursorTool]);
    setupMocks.discoverCursorSurfaces.mockReturnValue([]);
    setupMocks.discoverCursorExecutionPlan.mockReturnValue({
      targets: [], diagnostics: [invalidSelection], invalidSelection, surfaces: [],
    });
    setupMocks.getCredentialStore.mockImplementation(() => { throw new Error("credential store must not run"); });
    setupMocks.resolveWrapperReuse.mockRejectedValue(new Error("reuse must not run"));
    setupMocks.resolveAuth.mockRejectedValue(new Error("auth must not run"));
    setupMocks.resolveNodeBin.mockImplementation(() => { throw new Error("node resolution must not run"); });
    setupMocks.resolveMcpServerPath.mockImplementation(() => { throw new Error("MCP resolution must not run"); });
    setupMocks.resolveToolTargets.mockImplementation(() => { throw new Error("target resolution must not run"); });
    setupMocks.installToolSurface.mockImplementation(() => { throw new Error("writer must not run"); });

    await expect(run({ tool: "cursor" })).rejects.toThrow(invalidSelection);

    expect(setupMocks.discoverCursorExecutionPlan).toHaveBeenCalledOnce();
    expect(setupMocks.getCredentialStore).not.toHaveBeenCalled();
    expect(setupMocks.resolveWrapperReuse).not.toHaveBeenCalled();
    expect(setupMocks.resolveAuth).not.toHaveBeenCalled();
    expect(setupMocks.resolveNodeBin).not.toHaveBeenCalled();
    expect(setupMocks.resolveMcpServerPath).not.toHaveBeenCalled();
    expect(setupMocks.resolveToolTargets).not.toHaveBeenCalled();
    expect(setupMocks.installToolSurface).not.toHaveBeenCalled();
  });

  it("RED: configures Cursor only through planned WSL local and validated Windows bridge targets", async () => {
    const cursorSurfaces = [{ tool: "cursor", host: "local", surface: "cli", state: "executable-valid" }];
    setupMocks.detectTools.mockResolvedValue([cursorTool]);
    setupMocks.selectTools.mockResolvedValue([cursorTool]);
    setupMocks.discoverCursorSurfaces.mockReturnValue(cursorSurfaces);
    setupMocks.resolveAuth.mockResolvedValue({ apiUrl: "https://kanon.test", apiKey: "key", urlSource: "flag", keySource: "flag" });
    setupMocks.discoverCursorExecutionPlan.mockReturnValue({ targets: [localTarget, windowsTarget], bridge: { distribution: "Ubuntu-24.04", nodePath: "/opt/node/bin/node" }, diagnostics: [], surfaces: cursorSurfaces });
    setupMocks.planCursorSurfaceOutcomes.mockReturnValue({ results: [
      { surface: "cli", host: "local", outcome: "ready", paths: [localTarget.config()], message: "ready" },
      { surface: "ide", host: "windows", outcome: "ready", paths: [windowsTarget.config()], message: "ready" },
    ], diagnostics: [] });
    setupMocks.installToolSurface.mockImplementation(({ targets, buildEntry }: any) => targets.map((target: any) => {
      buildEntry(target, target.config());
      return { configPath: target.config(), skillDir: target.skills(), installedSkills: [], installedWorkflows: [], installedAgents: [], installedCommands: [] };
    }));

    await run({ tool: "cursor", apiUrl: "https://kanon.test", apiKey: "key" });

    expect(setupMocks.discoverCursorSurfaces).toHaveBeenCalledOnce();
    expect(setupMocks.detectTools).toHaveBeenCalledWith(expect.anything(), { cursorSurfaces });
    expect(setupMocks.discoverCursorExecutionPlan).toHaveBeenCalledOnce();
    expect(setupMocks.discoverCursorExecutionPlan).toHaveBeenCalledWith(expect.objectContaining({ surfaces: cursorSurfaces }));
    expect(setupMocks.planCursorSurfaceOutcomes).toHaveBeenCalledWith(expect.objectContaining({
      surfaces: cursorSurfaces,
      ownershipByTarget: {
        [localTarget.config()]: { targetKey: localTarget.config(), configPath: localTarget.config(), state: "missing" },
        [windowsTarget.config()]: { targetKey: windowsTarget.config(), configPath: windowsTarget.config(), state: "missing" },
      },
    }));
    expect(setupMocks.installToolSurface).toHaveBeenCalledWith(expect.objectContaining({ targets: [localTarget, windowsTarget] }));
    expect(setupMocks.buildMcpEntry).toHaveBeenCalledWith(expect.anything(), "https://kanon.test", "key", expect.anything(), "wsl-bridge", "/usr/bin/node", "static-key", "cursor", undefined, "Ubuntu-24.04", "/opt/node/bin/node");
    expect(setupMocks.finalizeCursorSurfaceResults).toHaveBeenCalledWith(expect.anything(), new Set([localTarget.config(), windowsTarget.config()]), "configure");
  });

  it("RED: remove mode stays on the legacy branch without configure planner discovery", async () => {
    setupMocks.detectTools.mockResolvedValue([cursorTool]);
    setupMocks.selectTools.mockResolvedValue([cursorTool]);
    setupMocks.resolveToolTargets.mockReturnValue([localTarget]);
    setupMocks.removeToolMcpConfig.mockReturnValue(false);
    setupMocks.removeSkills.mockReturnValue([]);
    setupMocks.removeWorkflows.mockReturnValue([]);
    setupMocks.removeAgents.mockReturnValue([]);
    setupMocks.removeCommands.mockReturnValue([]);

    await run({ tool: "cursor", remove: true });

    expect(setupMocks.discoverCursorSurfaces).not.toHaveBeenCalled();
    expect(setupMocks.detectTools).toHaveBeenCalledWith(expect.anything());
    expect(setupMocks.resolveToolTargets).toHaveBeenCalledWith(cursorTool, expect.anything());
    expect(setupMocks.discoverCursorExecutionPlan).not.toHaveBeenCalled();
    expect(setupMocks.planCursorSurfaceOutcomes).not.toHaveBeenCalled();
  });
});

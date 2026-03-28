import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { syncCommand } from "../../commands/sync.js";

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockSearch = vi.fn();
const mockCheckConnectivity = vi.fn();

vi.mock("@kanon/bridge", () => {
  const MockEngramClient = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.checkConnectivity = mockCheckConnectivity;
    this.search = mockSearch;
  });

  const MockSyncEngine = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.sync = vi.fn().mockResolvedValue({
      exported: 1,
      imported: 2,
      unchanged: 3,
      conflicts: 0,
      errors: [],
      items: [
        { issueKey: "KAN-1", action: "create", direction: "exported", success: true },
        { issueKey: "KAN-2", action: "update", direction: "imported", success: true },
        { issueKey: "KAN-3", action: "create", direction: "imported", success: true },
      ],
    });
  });

  return {
    EngramClient: MockEngramClient,
    SyncEngine: MockSyncEngine,
  };
});

vi.mock("../../config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({
    engramUrl: "http://localhost:7437",
    kanonApiUrl: "http://localhost:3000",
    kanonApiKey: "test-key",
  }),
}));

const mockGetProject = vi.fn();
const mockListIssues = vi.fn();

vi.mock("../../kanon-client.js", () => {
  class KanonApiError extends Error {
    public statusCode: number;
    public code: string;
    constructor(statusCode: number, code: string, message: string) {
      super(message);
      this.name = "KanonApiError";
      this.statusCode = statusCode;
      this.code = code;
    }
  }

  const MockKanonClient = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.getProject = mockGetProject;
    this.listIssues = mockListIssues;
    this.logActivity = vi.fn().mockResolvedValue(undefined);
  });

  return { KanonClient: MockKanonClient, KanonApiError };
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  syncCommand(program);
  return program;
}

function makeObservations() {
  return [
    { id: 1, title: "Obs one", content: "Content one", type: "decision", topic_key: "sdd/test/proposal" },
    { id: 2, title: "Obs two", content: "Content two", type: "architecture", topic_key: "sdd/test/design" },
  ];
}

function makeIssues() {
  return [
    {
      id: "i1",
      key: "KAN-1",
      title: "Issue one",
      type: "task",
      state: "open",
      priority: "medium",
      description: "First issue",
      parentId: null,
      labels: [],
      engramContext: null,
    },
    {
      id: "i2",
      key: "KAN-2",
      title: "Issue two",
      type: "bug",
      state: "in_progress",
      priority: "high",
      description: "Second issue",
      parentId: null,
      labels: ["urgent"],
      engramContext: null,
    },
  ];
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("sync command", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    mockGetProject.mockResolvedValue({
      id: "p1",
      key: "KAN",
      name: "Kanon",
      engramNamespace: "kanon-ns",
      workspaceId: "w1",
    });
    mockListIssues.mockResolvedValue(makeIssues());
    mockCheckConnectivity.mockResolvedValue({ ok: true });
    mockSearch.mockResolvedValue(makeObservations());
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  // ─── Argument Parsing ──────────────────────────────────────────────────

  describe("argument parsing", () => {
    it("requires --project flag", () => {
      const program = makeProgram();

      expect(() => {
        program.parse(["node", "kanon", "sync"]);
      }).toThrow();
    });

    it("accepts --project as required argument", async () => {
      const program = makeProgram();

      await program.parseAsync(
        ["node", "kanon", "sync", "--project", "KAN"],

      );

      expect(mockGetProject).toHaveBeenCalledWith("KAN");
    });

    it("defaults --strategy to newest-wins", async () => {
      const { SyncEngine } = await import("@kanon/bridge");

      const program = makeProgram();
      await program.parseAsync(
        ["node", "kanon", "sync", "--project", "KAN"],

      );

      const constructorArgs = (SyncEngine as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      const config = constructorArgs![2];
      expect(config.defaultStrategy).toBe("newest-wins");
    });

    it("accepts --strategy engram-wins", async () => {
      const { SyncEngine } = await import("@kanon/bridge");

      const program = makeProgram();
      await program.parseAsync(
        ["node", "kanon", "sync", "--project", "KAN", "--strategy", "engram-wins"],

      );

      const constructorArgs = (SyncEngine as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      const config = constructorArgs![2];
      expect(config.defaultStrategy).toBe("engram-wins");
    });

    it("accepts --strategy kanon-wins", async () => {
      const { SyncEngine } = await import("@kanon/bridge");

      const program = makeProgram();
      await program.parseAsync(
        ["node", "kanon", "sync", "--project", "KAN", "--strategy", "kanon-wins"],

      );

      const constructorArgs = (SyncEngine as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      const config = constructorArgs![2];
      expect(config.defaultStrategy).toBe("kanon-wins");
    });

    it("accepts --dry-run flag", async () => {
      const { SyncEngine } = await import("@kanon/bridge");

      const program = makeProgram();
      await program.parseAsync(
        ["node", "kanon", "sync", "--project", "KAN", "--dry-run"],

      );

      const engineInstance = (SyncEngine as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value;
      expect(engineInstance.sync).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(Array),
        expect.objectContaining({ dryRun: true }),
      );
    });

    it("accepts --namespace override", async () => {
      const program = makeProgram();

      await program.parseAsync(
        ["node", "kanon", "sync", "--project", "KAN", "--namespace", "custom-ns"],

      );

      expect(mockGetProject).toHaveBeenCalledWith("KAN");
    });

    it("accepts --engram-url and --kanon-url overrides", async () => {
      const program = makeProgram();

      await program.parseAsync(
        [
          "node", "kanon", "sync",
          "--project", "KAN",
          "--engram-url", "http://engram:9999",
          "--kanon-url", "http://kanon:4000",
        ],

      );

      expect(mockGetProject).toHaveBeenCalled();
    });
  });

  // ─── Dry Run Output ───────────────────────────────────────────────────

  describe("dry-run output", () => {
    it("prints dry run header when --dry-run is passed", async () => {
      const program = makeProgram();

      await program.parseAsync(
        ["node", "kanon", "sync", "--project", "KAN", "--dry-run"],

      );

      const allOutput = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(allOutput).toContain("Dry run");
    });

    it("does not mutate when --dry-run is set (sync receives dryRun: true)", async () => {
      const { SyncEngine } = await import("@kanon/bridge");

      const program = makeProgram();
      await program.parseAsync(
        ["node", "kanon", "sync", "--project", "KAN", "--dry-run"],

      );

      const engineInstance = (SyncEngine as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value;
      const callArgs = engineInstance.sync.mock.calls[0];
      expect(callArgs[2]).toEqual(
        expect.objectContaining({ dryRun: true }),
      );
    });

    it("prints summary with both Exported and Imported counts", async () => {
      const program = makeProgram();

      await program.parseAsync(
        ["node", "kanon", "sync", "--project", "KAN"],

      );

      const allOutput = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(allOutput).toContain("Summary");
      expect(allOutput).toContain("Exported");
      expect(allOutput).toContain("Imported");
      expect(allOutput).toContain("Unchanged");
    });
  });

  // ─── Progress Format ──────────────────────────────────────────────────

  describe("progress format", () => {
    it("passes onProgress callback to SyncEngine", async () => {
      const { SyncEngine } = await import("@kanon/bridge");

      const program = makeProgram();
      await program.parseAsync(
        ["node", "kanon", "sync", "--project", "KAN"],

      );

      const constructorArgs = (SyncEngine as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      const config = constructorArgs![2];
      expect(config).toHaveProperty("onProgress");
      expect(typeof config.onProgress).toBe("function");
    });

    it("onProgress callback logs [current/total] format", async () => {
      const { SyncEngine } = await import("@kanon/bridge");

      const program = makeProgram();
      await program.parseAsync(
        ["node", "kanon", "sync", "--project", "KAN"],

      );

      const constructorArgs = (SyncEngine as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      const config = constructorArgs![2];

      config.onProgress(5, 12, "KAN-5");

      const allOutput = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(allOutput).toContain("[5/12]");
      expect(allOutput).toContain("KAN-5");
    });
  });

  // ─── Activity Logging ───────────────────────────────────────────────────

  describe("activity logging", () => {
    it("logs engram_synced activity for each successfully synced item", async () => {
      const { KanonClient } = await import("../../kanon-client.js");

      const program = makeProgram();
      await program.parseAsync(
        ["node", "kanon", "sync", "--project", "KAN"],
      );

      const kanonInstance = (KanonClient as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value;
      // 3 success items in the mock result
      expect(kanonInstance.logActivity).toHaveBeenCalledTimes(3);
      expect(kanonInstance.logActivity).toHaveBeenCalledWith(
        "KAN-1",
        "engram_synced",
        { direction: "exported", action: "create" },
      );
      expect(kanonInstance.logActivity).toHaveBeenCalledWith(
        "KAN-2",
        "engram_synced",
        { direction: "imported", action: "update" },
      );
    });

    it("does not log activity during dry run", async () => {
      const { KanonClient } = await import("../../kanon-client.js");

      const program = makeProgram();
      await program.parseAsync(
        ["node", "kanon", "sync", "--project", "KAN", "--dry-run"],
      );

      const kanonInstance = (KanonClient as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value;
      expect(kanonInstance.logActivity).not.toHaveBeenCalled();
    });

    it("does not fail the command when activity logging fails", async () => {
      const { KanonClient } = await import("../../kanon-client.js");
      const mockCtor = KanonClient as unknown as ReturnType<typeof vi.fn>;
      const originalImpl = mockCtor.getMockImplementation();

      mockCtor.mockImplementation(function (this: Record<string, unknown>) {
        this.getProject = mockGetProject;
        this.listIssues = mockListIssues;
        this.logActivity = vi.fn().mockRejectedValue(new Error("API down"));
      });

      const program = makeProgram();
      // Should not throw
      await program.parseAsync(
        ["node", "kanon", "sync", "--project", "KAN"],
      );

      const errorOutput = consoleErrorSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(errorOutput).toContain("Warning: Failed to log activity");

      // Restore original mock implementation so subsequent tests are unaffected
      if (originalImpl) mockCtor.mockImplementation(originalImpl);
    });
  });

  // ─── Error Handling ───────────────────────────────────────────────────

  describe("error handling", () => {
    it("exits when project is not found (404)", async () => {
      const { KanonApiError } = await import("../../kanon-client.js");
      mockGetProject.mockRejectedValue(
        new KanonApiError(404, "NOT_FOUND", "Project not found"),
      );

      const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
        throw new Error("process.exit called");
      }) as never);

      const program = makeProgram();
      await expect(
        program.parseAsync(
          ["node", "kanon", "sync", "--project", "MISSING"],
  
        ),
      ).rejects.toThrow("process.exit called");

      expect(exitSpy).toHaveBeenCalledWith(1);
      exitSpy.mockRestore();
    });

    it("exits when project has no engram namespace and no --namespace given", async () => {
      mockGetProject.mockResolvedValue({
        id: "p2",
        key: "NONS",
        name: "No Namespace",
        engramNamespace: null,
        workspaceId: "w1",
      });

      const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
        throw new Error("process.exit called");
      }) as never);

      const program = makeProgram();
      await expect(
        program.parseAsync(
          ["node", "kanon", "sync", "--project", "NONS"],
  
        ),
      ).rejects.toThrow("process.exit called");

      const errorOutput = consoleErrorSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(errorOutput).toContain("no Engram namespace");
      exitSpy.mockRestore();
    });

    it("rejects invalid strategy", async () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
        throw new Error("process.exit called");
      }) as never);

      const program = makeProgram();
      await expect(
        program.parseAsync(
          ["node", "kanon", "sync", "--project", "KAN", "--strategy", "bad-strategy"],
  
        ),
      ).rejects.toThrow("process.exit called");

      const errorOutput = consoleErrorSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(errorOutput).toContain("Invalid strategy");
      exitSpy.mockRestore();
    });

    it("exits when Engram is not reachable", async () => {
      mockCheckConnectivity.mockResolvedValue({ ok: false });

      const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
        throw new Error("process.exit called");
      }) as never);

      const program = makeProgram();
      await expect(
        program.parseAsync(
          ["node", "kanon", "sync", "--project", "KAN"],
  
        ),
      ).rejects.toThrow("process.exit called");

      const errorOutput = consoleErrorSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(errorOutput).toContain("not reachable");
      exitSpy.mockRestore();
    });

    it("prints nothing-to-sync when both sides are empty", async () => {
      mockListIssues.mockResolvedValue([]);
      mockSearch.mockResolvedValue([]);

      const program = makeProgram();
      await program.parseAsync(
        ["node", "kanon", "sync", "--project", "KAN"],

      );

      const allOutput = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(allOutput).toContain("Nothing to sync");
    });

    it("displays sync errors in summary when result has errors", async () => {
      const { SyncEngine } = await import("@kanon/bridge");
      (SyncEngine as unknown as ReturnType<typeof vi.fn>).mockImplementation(function (this: Record<string, unknown>) {
        this.sync = vi.fn().mockResolvedValue({
          exported: 0,
          imported: 0,
          unchanged: 0,
          conflicts: 0,
          errors: [
            { item: "KAN-99", error: "Connection refused" },
          ],
          items: [],
        });
      });

      const program = makeProgram();
      await program.parseAsync(
        ["node", "kanon", "sync", "--project", "KAN"],

      );

      const allOutput = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(allOutput).toContain("Errors");
      expect(allOutput).toContain("KAN-99");
      expect(allOutput).toContain("Connection refused");
    });
  });

  // ─── Bidirectional Behavior ────────────────────────────────────────────

  describe("bidirectional behavior", () => {
    it("fetches both issues and observations in parallel", async () => {
      const program = makeProgram();

      await program.parseAsync(
        ["node", "kanon", "sync", "--project", "KAN"],

      );

      // Both should be called (fetched in Promise.all)
      expect(mockListIssues).toHaveBeenCalledWith("KAN");
      expect(mockSearch).toHaveBeenCalledWith("", expect.objectContaining({ project: "kanon-ns" }));
    });

    it("passes both issues and observations to syncEngine.sync", async () => {
      const { SyncEngine } = await import("@kanon/bridge");

      const program = makeProgram();
      await program.parseAsync(
        ["node", "kanon", "sync", "--project", "KAN"],

      );

      const engineInstance = (SyncEngine as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value;
      const callArgs = engineInstance.sync.mock.calls[0];

      // First arg: syncableIssues (converted from issues)
      expect(callArgs[0]).toHaveLength(2);
      expect(callArgs[0][0]).toHaveProperty("key", "KAN-1");

      // Second arg: observations
      expect(callArgs[1]).toHaveLength(2);
      expect(callArgs[1][0]).toHaveProperty("topic_key", "sdd/test/proposal");
    });
  });
});

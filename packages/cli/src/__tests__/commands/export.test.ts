import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { exportCommand } from "../../commands/export.js";

// ─── Mocks ──────────────────────────────────────────────────────────────────

// Mock @kanon/bridge
vi.mock("@kanon/bridge", () => {
  const MockEngramClient = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.checkConnectivity = vi.fn().mockResolvedValue({ ok: true });
    this.search = vi.fn().mockResolvedValue([]);
  });

  const MockSyncEngine = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.exportToEngram = vi.fn().mockResolvedValue({
      exported: 2,
      imported: 0,
      unchanged: 1,
      conflicts: 0,
      errors: [],
      items: [
        { issueKey: "KAN-1", action: "create", direction: "exported", success: true },
        { issueKey: "KAN-2", action: "update", direction: "exported", success: true },
      ],
    });
  });

  return {
    EngramClient: MockEngramClient,
    SyncEngine: MockSyncEngine,
  };
});

// Mock ../config.js
vi.mock("../../config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({
    engramUrl: "http://localhost:7437",
    kanonApiUrl: "http://localhost:3000",
    kanonApiKey: "test-key",
  }),
}));

// Mock ../kanon-client.js
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
  program.exitOverride(); // throw instead of process.exit for testability
  exportCommand(program);
  return program;
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

describe("export command", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Default happy-path mocks
    mockGetProject.mockResolvedValue({
      id: "p1",
      key: "KAN",
      name: "Kanon",
      engramNamespace: "kanon-ns",
      workspaceId: "w1",
    });
    mockListIssues.mockResolvedValue(makeIssues());
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
        program.parse(["node", "kanon", "export"]);
      }).toThrow();
    });

    it("accepts --project as required argument", async () => {
      const program = makeProgram();

      await program.parseAsync(
        ["node", "kanon", "export", "--project", "KAN"],
      );

      expect(mockGetProject).toHaveBeenCalledWith("KAN");
    });

    it("accepts --namespace override", async () => {
      const program = makeProgram();

      await program.parseAsync(
        ["node", "kanon", "export", "--project", "KAN", "--namespace", "custom-ns"],
      );

      // Verifies command ran successfully with custom namespace
      expect(mockGetProject).toHaveBeenCalledWith("KAN");
    });

    it("accepts --dry-run flag", async () => {
      const { SyncEngine } = await import("@kanon/bridge");

      const program = makeProgram();
      await program.parseAsync(
        ["node", "kanon", "export", "--project", "KAN", "--dry-run"],
      );

      // Verify SyncEngine.exportToEngram was called with dryRun: true
      const engineInstance = (SyncEngine as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value;
      expect(engineInstance.exportToEngram).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ dryRun: true }),
      );
    });

    it("accepts --engram-url override", async () => {
      const { EngramClient } = await import("@kanon/bridge");

      const program = makeProgram();
      await program.parseAsync(
        ["node", "kanon", "export", "--project", "KAN", "--engram-url", "http://custom:9999"],
      );

      expect(mockGetProject).toHaveBeenCalled();
    });

    it("accepts --kanon-url override", async () => {
      const program = makeProgram();

      await program.parseAsync(
        ["node", "kanon", "export", "--project", "KAN", "--kanon-url", "http://kanon:4000"],
      );

      expect(mockGetProject).toHaveBeenCalled();
    });

    it("accepts --filter-state option", async () => {
      const program = makeProgram();

      await program.parseAsync(
        ["node", "kanon", "export", "--project", "KAN", "--filter-state", "open"],
      );

      expect(mockGetProject).toHaveBeenCalledWith("KAN");
    });

    it("accepts --filter-type option", async () => {
      const program = makeProgram();

      await program.parseAsync(
        ["node", "kanon", "export", "--project", "KAN", "--filter-type", "bug"],
      );

      expect(mockGetProject).toHaveBeenCalledWith("KAN");
    });
  });

  // ─── Dry Run Output ───────────────────────────────────────────────────

  describe("dry-run output", () => {
    it("prints dry run header when --dry-run is passed", async () => {
      const program = makeProgram();

      await program.parseAsync(
        ["node", "kanon", "export", "--project", "KAN", "--dry-run"],

      );

      const allOutput = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(allOutput).toContain("Dry run");
    });

    it("does not mutate when --dry-run is set (exportToEngram receives dryRun: true)", async () => {
      const { SyncEngine } = await import("@kanon/bridge");

      const program = makeProgram();
      await program.parseAsync(
        ["node", "kanon", "export", "--project", "KAN", "--dry-run"],

      );

      const engineInstance = (SyncEngine as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value;
      const callArgs = engineInstance.exportToEngram.mock.calls[0];
      expect(callArgs[1]).toEqual(expect.objectContaining({ dryRun: true }));
    });

    it("prints summary after export", async () => {
      const program = makeProgram();

      await program.parseAsync(
        ["node", "kanon", "export", "--project", "KAN"],

      );

      const allOutput = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(allOutput).toContain("Summary");
      expect(allOutput).toContain("Exported");
      expect(allOutput).toContain("Unchanged");
    });
  });

  // ─── Progress Format ──────────────────────────────────────────────────

  describe("progress format", () => {
    it("passes onProgress callback to SyncEngine", async () => {
      const { SyncEngine } = await import("@kanon/bridge");

      const program = makeProgram();
      await program.parseAsync(
        ["node", "kanon", "export", "--project", "KAN"],

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
        ["node", "kanon", "export", "--project", "KAN"],

      );

      const constructorArgs = (SyncEngine as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      const config = constructorArgs![2];

      // Invoke the onProgress callback manually
      config.onProgress(3, 10, "KAN-3");

      const allOutput = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(allOutput).toContain("[3/10]");
      expect(allOutput).toContain("KAN-3");
    });
  });

  // ─── Activity Logging ───────────────────────────────────────────────────

  describe("activity logging", () => {
    it("logs engram_synced activity for each successfully exported item", async () => {
      const { KanonClient } = await import("../../kanon-client.js");

      const program = makeProgram();
      await program.parseAsync(
        ["node", "kanon", "export", "--project", "KAN"],
      );

      const kanonInstance = (KanonClient as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value;
      // 2 success items in the mock result
      expect(kanonInstance.logActivity).toHaveBeenCalledTimes(2);
      expect(kanonInstance.logActivity).toHaveBeenCalledWith(
        "KAN-1",
        "engram_synced",
        { direction: "exported", action: "create" },
      );
      expect(kanonInstance.logActivity).toHaveBeenCalledWith(
        "KAN-2",
        "engram_synced",
        { direction: "exported", action: "update" },
      );
    });

    it("does not log activity during dry run", async () => {
      const { KanonClient } = await import("../../kanon-client.js");

      const program = makeProgram();
      await program.parseAsync(
        ["node", "kanon", "export", "--project", "KAN", "--dry-run"],
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
      await program.parseAsync(
        ["node", "kanon", "export", "--project", "KAN"],
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
          ["node", "kanon", "export", "--project", "MISSING"],
  
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
          ["node", "kanon", "export", "--project", "NONS"],
  
        ),
      ).rejects.toThrow("process.exit called");

      const errorOutput = consoleErrorSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(errorOutput).toContain("no Engram namespace");
      exitSpy.mockRestore();
    });

    it("exits when Engram is not reachable", async () => {
      const { EngramClient } = await import("@kanon/bridge");
      (EngramClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(function (this: Record<string, unknown>) {
        this.checkConnectivity = vi.fn().mockResolvedValue({ ok: false });
      });

      const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
        throw new Error("process.exit called");
      }) as never);

      const program = makeProgram();
      await expect(
        program.parseAsync(
          ["node", "kanon", "export", "--project", "KAN"],
  
        ),
      ).rejects.toThrow("process.exit called");

      const errorOutput = consoleErrorSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(errorOutput).toContain("not reachable");
      exitSpy.mockRestore();
    });

    it("prints nothing-to-export when no issues found", async () => {
      mockListIssues.mockResolvedValue([]);

      const program = makeProgram();
      await program.parseAsync(
        ["node", "kanon", "export", "--project", "KAN"],

      );

      const allOutput = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(allOutput).toContain("Nothing to export");
    });
  });

  // ─── Filtering ───────────────────────────────────────────────────────

  describe("filtering", () => {
    beforeEach(async () => {
      // Re-establish default EngramClient mock (may have been overridden by earlier tests)
      const { EngramClient } = await import("@kanon/bridge");
      (EngramClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(function (this: Record<string, unknown>) {
        this.checkConnectivity = vi.fn().mockResolvedValue({ ok: true });
        this.search = vi.fn().mockResolvedValue([]);
      });
    });

    it("filters issues by --filter-state", async () => {
      const { SyncEngine } = await import("@kanon/bridge");

      const program = makeProgram();
      await program.parseAsync(
        ["node", "kanon", "export", "--project", "KAN", "--filter-state", "open"],
      );

      // Only the issue with state "open" (KAN-1) should be exported
      const engineInstance = (SyncEngine as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value;
      const callArgs = engineInstance.exportToEngram.mock.calls[0];
      const exportedIssues = callArgs[0];
      expect(exportedIssues).toHaveLength(1);
      expect(exportedIssues[0].key).toBe("KAN-1");
    });

    it("filters issues by --filter-type", async () => {
      const { SyncEngine } = await import("@kanon/bridge");

      const program = makeProgram();
      await program.parseAsync(
        ["node", "kanon", "export", "--project", "KAN", "--filter-type", "bug"],
      );

      // Only the issue with type "bug" (KAN-2) should be exported
      const engineInstance = (SyncEngine as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value;
      const callArgs = engineInstance.exportToEngram.mock.calls[0];
      const exportedIssues = callArgs[0];
      expect(exportedIssues).toHaveLength(1);
      expect(exportedIssues[0].key).toBe("KAN-2");
    });

    it("combines --filter-state and --filter-type", async () => {
      const { SyncEngine } = await import("@kanon/bridge");

      const program = makeProgram();
      await program.parseAsync(
        ["node", "kanon", "export", "--project", "KAN", "--filter-state", "in_progress", "--filter-type", "bug"],
      );

      // Only KAN-2 matches both state=in_progress AND type=bug
      const engineInstance = (SyncEngine as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value;
      const callArgs = engineInstance.exportToEngram.mock.calls[0];
      const exportedIssues = callArgs[0];
      expect(exportedIssues).toHaveLength(1);
      expect(exportedIssues[0].key).toBe("KAN-2");
    });

    it("prints nothing-to-export when filters match no issues", async () => {
      const program = makeProgram();
      await program.parseAsync(
        ["node", "kanon", "export", "--project", "KAN", "--filter-state", "closed"],
      );

      const allOutput = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(allOutput).toContain("Nothing to export");
    });
  });
});

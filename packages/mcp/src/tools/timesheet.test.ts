// ─── Timesheet Tools — unit tests ────────────────────────────────────────────
//
// Tools covered:
//   kanon_list_my_worklogs, kanon_promote_worklog, kanon_update_time_entry,
//   kanon_submit_time_entry, kanon_approve_time_entry, kanon_reject_time_entry,
//   kanon_adjust_time_entry
//
// Pattern mirrors work-sessions.test.ts — captureTools() harness + mocked KanonClient.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTimesheetTools, TIMESHEET_DEFERRED_TOOLS } from "./timesheet.js";
import { PromoteWorklogInput, UpdateTimeEntryInput, AdjustTimeEntryInput } from "./timesheet.js";
import type { KanonClient } from "../kanon-client.js";

// ─── Harness ────────────────────────────────────────────────────────────────

type ToolHandler = (input: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

interface RegisteredTool {
  name: string;
  description: string;
  shape: unknown;
  handler: ToolHandler;
}

function captureTools(
  register: (server: McpServer, client: KanonClient) => void,
  client: KanonClient,
): Map<string, RegisteredTool> {
  const tools = new Map<string, RegisteredTool>();
  const fakeServer = {
    tool: (name: string, description: string, shape: unknown, handler: ToolHandler) => {
      tools.set(name, { name, description, shape, handler });
    },
  } as unknown as McpServer;
  register(fakeServer, client);
  return tools;
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

const fakeWorklogList = {
  worklogs: [
    {
      id: "wl-1",
      startedAt: "2026-06-10T09:00:00.000Z",
      endedAt: "2026-06-10T11:00:00.000Z",
      durationS: 7200,
      reason: "stopped",
      via: "mcp",
      issueId: "issue-uuid-1",
      member: { id: "mem-1", username: "alice", isAgent: false },
    },
  ],
  totalDurationS: 7200,
};

const fakeTimeEntry = {
  id: "te-1",
  memberId: "mem-1",
  issueId: "issue-uuid-1",
  hours: "2.00",
  workedOn: "2026-06-10T00:00:00.000Z",
  status: "draft",
  sourceWorkLogId: "wl-1",
  adjustsId: null,
  costRateSnapshot: null,
  billRateSnapshot: null,
  via: "mcp",
  approvedById: null,
  approvedAt: null,
  createdAt: "2026-06-10T11:00:00.000Z",
  updatedAt: "2026-06-10T11:00:00.000Z",
};

const fakeApprovedEntry = { ...fakeTimeEntry, status: "approved", approvedById: "mem-2" };

// ─── Registration test ───────────────────────────────────────────────────────

describe("registerTimesheetTools — registration", () => {
  it("registers all 7 timesheet tools", () => {
    const mockClient = {} as unknown as KanonClient;
    const tools = captureTools(registerTimesheetTools, mockClient);

    expect(tools.has("kanon_list_my_worklogs")).toBe(true);
    expect(tools.has("kanon_promote_worklog")).toBe(true);
    expect(tools.has("kanon_update_time_entry")).toBe(true);
    expect(tools.has("kanon_submit_time_entry")).toBe(true);
    expect(tools.has("kanon_approve_time_entry")).toBe(true);
    expect(tools.has("kanon_reject_time_entry")).toBe(true);
    expect(tools.has("kanon_adjust_time_entry")).toBe(true);
    expect(tools.size).toBe(7);
  });

  it("TIMESHEET_DEFERRED_TOOLS contains approve and reject (PM-only)", () => {
    expect(TIMESHEET_DEFERRED_TOOLS).toContain("kanon_approve_time_entry");
    expect(TIMESHEET_DEFERRED_TOOLS).toContain("kanon_reject_time_entry");
  });
});

// ─── kanon_list_my_worklogs ──────────────────────────────────────────────────

describe("kanon_list_my_worklogs", () => {
  let mockClient: { listMyWorklogs: ReturnType<typeof vi.fn> };
  let tool: RegisteredTool;

  beforeEach(() => {
    mockClient = { listMyWorklogs: vi.fn().mockResolvedValue(fakeWorklogList) };
    const tools = captureTools(registerTimesheetTools, mockClient as unknown as KanonClient);
    const t = tools.get("kanon_list_my_worklogs");
    if (!t) throw new Error("kanon_list_my_worklogs not registered");
    tool = t;
  });

  it("happy path: calls listMyWorklogs with workspaceId and returns worklog list", async () => {
    const result = await tool.handler({ workspaceId: "ws-uuid-1" });

    expect(mockClient.listMyWorklogs).toHaveBeenCalledWith("ws-uuid-1", undefined, undefined, undefined);
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("worklogs");
    expect(parsed.worklogs).toHaveLength(1);
    expect(parsed.worklogs[0]).toHaveProperty("id", "wl-1");
    expect(parsed).toHaveProperty("totalDurationS", 7200);
  });

  it("forwards optional filters (from, to, limit) to the client method", async () => {
    await tool.handler({
      workspaceId: "ws-uuid-1",
      from: "2026-06-01T00:00:00.000Z",
      to: "2026-06-30T23:59:59.000Z",
      limit: 10,
    });

    expect(mockClient.listMyWorklogs).toHaveBeenCalledWith(
      "ws-uuid-1",
      "2026-06-01T00:00:00.000Z",
      "2026-06-30T23:59:59.000Z",
      10,
    );
  });

  it("error path: client throws → returns errorResult", async () => {
    mockClient.listMyWorklogs = vi.fn().mockRejectedValue(new Error("network failure"));
    const tools = captureTools(registerTimesheetTools, mockClient as unknown as KanonClient);
    const errorTool = tools.get("kanon_list_my_worklogs")!;

    const result = await errorTool.handler({ workspaceId: "ws-uuid-1" });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("error");
  });
});

// ─── kanon_promote_worklog ───────────────────────────────────────────────────

describe("kanon_promote_worklog", () => {
  let mockClient: { promoteWorklog: ReturnType<typeof vi.fn> };
  let tool: RegisteredTool;

  beforeEach(() => {
    mockClient = { promoteWorklog: vi.fn().mockResolvedValue(fakeTimeEntry) };
    const tools = captureTools(registerTimesheetTools, mockClient as unknown as KanonClient);
    const t = tools.get("kanon_promote_worklog");
    if (!t) throw new Error("kanon_promote_worklog not registered");
    tool = t;
  });

  it("happy path: calls promoteWorklog with worklogId and no overrides", async () => {
    const result = await tool.handler({ worklogId: "wl-1" });

    expect(mockClient.promoteWorklog).toHaveBeenCalledWith("wl-1", {});
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("id", "te-1");
    expect(parsed).toHaveProperty("status", "draft");
  });

  it("passes optional override fields to promoteWorklog", async () => {
    await tool.handler({
      worklogId: "wl-1",
      hours: "3.00",
      issueId: "issue-uuid-2",
      workedOn: "2026-06-11T00:00:00.000Z",
    });

    expect(mockClient.promoteWorklog).toHaveBeenCalledWith("wl-1", {
      hours: "3.00",
      issueId: "issue-uuid-2",
      workedOn: "2026-06-11T00:00:00.000Z",
    });
  });

  it("error path: client throws → returns errorResult", async () => {
    mockClient.promoteWorklog = vi.fn().mockRejectedValue(new Error("not found"));
    const tools = captureTools(registerTimesheetTools, mockClient as unknown as KanonClient);
    const errorTool = tools.get("kanon_promote_worklog")!;

    const result = await errorTool.handler({ worklogId: "wl-1" });

    expect(result.isError).toBe(true);
  });
});

// ─── kanon_update_time_entry ─────────────────────────────────────────────────

describe("kanon_update_time_entry", () => {
  let mockClient: { updateTimeEntry: ReturnType<typeof vi.fn> };
  let tool: RegisteredTool;

  beforeEach(() => {
    mockClient = { updateTimeEntry: vi.fn().mockResolvedValue(fakeTimeEntry) };
    const tools = captureTools(registerTimesheetTools, mockClient as unknown as KanonClient);
    const t = tools.get("kanon_update_time_entry");
    if (!t) throw new Error("kanon_update_time_entry not registered");
    tool = t;
  });

  it("happy path: calls updateTimeEntry with timeEntryId and patch fields", async () => {
    const result = await tool.handler({ timeEntryId: "te-1", hours: "3.00" });

    expect(mockClient.updateTimeEntry).toHaveBeenCalledWith("te-1", { hours: "3.00" });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("id", "te-1");
  });

  it("passes all optional fields when provided", async () => {
    await tool.handler({
      timeEntryId: "te-1",
      hours: "1.50",
      issueId: "issue-uuid-2",
      workedOn: "2026-06-12T00:00:00.000Z",
    });

    expect(mockClient.updateTimeEntry).toHaveBeenCalledWith("te-1", {
      hours: "1.50",
      issueId: "issue-uuid-2",
      workedOn: "2026-06-12T00:00:00.000Z",
    });
  });

  it("error path: client throws → returns errorResult", async () => {
    mockClient.updateTimeEntry = vi.fn().mockRejectedValue(new Error("forbidden"));
    const tools = captureTools(registerTimesheetTools, mockClient as unknown as KanonClient);
    const errorTool = tools.get("kanon_update_time_entry")!;

    const result = await errorTool.handler({ timeEntryId: "te-1" });

    expect(result.isError).toBe(true);
  });
});

// ─── kanon_submit_time_entry ─────────────────────────────────────────────────

describe("kanon_submit_time_entry", () => {
  let mockClient: { submitTimeEntry: ReturnType<typeof vi.fn> };
  let tool: RegisteredTool;

  beforeEach(() => {
    mockClient = {
      submitTimeEntry: vi.fn().mockResolvedValue({ ...fakeTimeEntry, status: "submitted" }),
    };
    const tools = captureTools(registerTimesheetTools, mockClient as unknown as KanonClient);
    const t = tools.get("kanon_submit_time_entry");
    if (!t) throw new Error("kanon_submit_time_entry not registered");
    tool = t;
  });

  it("happy path: calls submitTimeEntry with timeEntryId, returns submitted entry", async () => {
    const result = await tool.handler({ timeEntryId: "te-1" });

    expect(mockClient.submitTimeEntry).toHaveBeenCalledWith("te-1");
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("status", "submitted");
  });

  it("error path: client throws → returns errorResult", async () => {
    mockClient.submitTimeEntry = vi.fn().mockRejectedValue(new Error("already submitted"));
    const tools = captureTools(registerTimesheetTools, mockClient as unknown as KanonClient);
    const errorTool = tools.get("kanon_submit_time_entry")!;

    const result = await errorTool.handler({ timeEntryId: "te-1" });

    expect(result.isError).toBe(true);
  });
});

// ─── kanon_approve_time_entry ────────────────────────────────────────────────

describe("kanon_approve_time_entry", () => {
  let mockClient: { approveTimeEntry: ReturnType<typeof vi.fn> };
  let tool: RegisteredTool;

  beforeEach(() => {
    mockClient = { approveTimeEntry: vi.fn().mockResolvedValue(fakeApprovedEntry) };
    const tools = captureTools(registerTimesheetTools, mockClient as unknown as KanonClient);
    const t = tools.get("kanon_approve_time_entry");
    if (!t) throw new Error("kanon_approve_time_entry not registered");
    tool = t;
  });

  it("happy path: calls approveTimeEntry with timeEntryId, returns approved entry", async () => {
    const result = await tool.handler({ timeEntryId: "te-1" });

    expect(mockClient.approveTimeEntry).toHaveBeenCalledWith("te-1");
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("status", "approved");
    expect(parsed).toHaveProperty("approvedById", "mem-2");
  });

  it("error path: 403 from API (non-PM caller) → surfaces as errorResult, not a throw", async () => {
    const { KanonApiError } = await import("../kanon-client.js");
    mockClient.approveTimeEntry = vi.fn().mockRejectedValue(
      new KanonApiError(403, "FORBIDDEN", "Insufficient role: pm required"),
    );
    const tools = captureTools(registerTimesheetTools, mockClient as unknown as KanonClient);
    const errorTool = tools.get("kanon_approve_time_entry")!;

    const result = await errorTool.handler({ timeEntryId: "te-1" });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("code", "FORBIDDEN");
    expect(parsed.error).toContain("403");
  });
});

// ─── kanon_reject_time_entry ─────────────────────────────────────────────────

describe("kanon_reject_time_entry", () => {
  let mockClient: { rejectTimeEntry: ReturnType<typeof vi.fn> };
  let tool: RegisteredTool;

  beforeEach(() => {
    mockClient = {
      rejectTimeEntry: vi.fn().mockResolvedValue({ ...fakeTimeEntry, status: "rejected" }),
    };
    const tools = captureTools(registerTimesheetTools, mockClient as unknown as KanonClient);
    const t = tools.get("kanon_reject_time_entry");
    if (!t) throw new Error("kanon_reject_time_entry not registered");
    tool = t;
  });

  it("happy path: calls rejectTimeEntry with timeEntryId and no reason", async () => {
    const result = await tool.handler({ timeEntryId: "te-1" });

    expect(mockClient.rejectTimeEntry).toHaveBeenCalledWith("te-1", {});
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("status", "rejected");
  });

  it("passes optional reason to rejectTimeEntry", async () => {
    await tool.handler({ timeEntryId: "te-1", reason: "Duplicate entry" });

    expect(mockClient.rejectTimeEntry).toHaveBeenCalledWith("te-1", { reason: "Duplicate entry" });
  });

  it("error path: 403 from API (non-PM caller) → surfaces as errorResult", async () => {
    const { KanonApiError } = await import("../kanon-client.js");
    mockClient.rejectTimeEntry = vi.fn().mockRejectedValue(
      new KanonApiError(403, "FORBIDDEN", "Insufficient role: pm required"),
    );
    const tools = captureTools(registerTimesheetTools, mockClient as unknown as KanonClient);
    const errorTool = tools.get("kanon_reject_time_entry")!;

    const result = await errorTool.handler({ timeEntryId: "te-1" });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("code", "FORBIDDEN");
  });
});

// ─── kanon_adjust_time_entry ─────────────────────────────────────────────────

describe("kanon_adjust_time_entry", () => {
  let mockClient: { adjustTimeEntry: ReturnType<typeof vi.fn> };
  let tool: RegisteredTool;

  const fakeAdjustment = {
    ...fakeTimeEntry,
    id: "te-2",
    hours: "-1.00",
    adjustsId: "te-1",
    status: "draft",
  };

  beforeEach(() => {
    mockClient = { adjustTimeEntry: vi.fn().mockResolvedValue(fakeAdjustment) };
    const tools = captureTools(registerTimesheetTools, mockClient as unknown as KanonClient);
    const t = tools.get("kanon_adjust_time_entry");
    if (!t) throw new Error("kanon_adjust_time_entry not registered");
    tool = t;
  });

  it("happy path: calls adjustTimeEntry with timeEntryId, hours, and optional fields", async () => {
    const result = await tool.handler({
      timeEntryId: "te-1",
      hours: "-1.00",
      workedOn: "2026-06-10T00:00:00.000Z",
    });

    expect(mockClient.adjustTimeEntry).toHaveBeenCalledWith("te-1", {
      hours: "-1.00",
      workedOn: "2026-06-10T00:00:00.000Z",
    });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("adjustsId", "te-1");
    expect(parsed).toHaveProperty("hours", "-1.00");
  });

  it("accepts positive hours adjustment (workedOn required)", async () => {
    await tool.handler({
      timeEntryId: "te-1",
      hours: "0.50",
      workedOn: "2026-06-10T00:00:00.000Z",
    });

    expect(mockClient.adjustTimeEntry).toHaveBeenCalledWith("te-1", {
      hours: "0.50",
      workedOn: "2026-06-10T00:00:00.000Z",
    });
  });

  it("passes issueId when provided", async () => {
    await tool.handler({
      timeEntryId: "te-1",
      hours: "-1.00",
      workedOn: "2026-06-10T00:00:00.000Z",
      issueId: "issue-uuid-3",
    });

    expect(mockClient.adjustTimeEntry).toHaveBeenCalledWith("te-1", {
      hours: "-1.00",
      workedOn: "2026-06-10T00:00:00.000Z",
      issueId: "issue-uuid-3",
    });
  });

  it("error path: client throws → returns errorResult", async () => {
    mockClient.adjustTimeEntry = vi.fn().mockRejectedValue(new Error("entry not approved"));
    const tools = captureTools(registerTimesheetTools, mockClient as unknown as KanonClient);
    const errorTool = tools.get("kanon_adjust_time_entry")!;

    const result = await errorTool.handler({
      timeEntryId: "te-1",
      hours: "-0.50",
      workedOn: "2026-06-10T00:00:00.000Z",
    });

    expect(result.isError).toBe(true);
  });
});

// ─── Input schema contract tests ─────────────────────────────────────────────
// These tests parse the exported Zod schemas directly so we can assert
// contract constraints (regex, required fields) independently of the
// tool handler harness, which receives pre-validated input.

describe("AdjustTimeEntryInput schema — contract", () => {
  it("rejects input when workedOn is omitted (workedOn is required)", () => {
    expect(() =>
      AdjustTimeEntryInput.parse({
        timeEntryId: "00000000-0000-0000-0000-000000000001",
        hours: "-1.00",
        // workedOn intentionally omitted
      }),
    ).toThrow();
  });

  it("accepts valid signed negative hours", () => {
    expect(() =>
      AdjustTimeEntryInput.parse({
        timeEntryId: "00000000-0000-0000-0000-000000000001",
        hours: "-1.00",
        workedOn: "2026-06-10T00:00:00.000Z",
      }),
    ).not.toThrow();
  });

  it("accepts valid positive hours", () => {
    expect(() =>
      AdjustTimeEntryInput.parse({
        timeEntryId: "00000000-0000-0000-0000-000000000001",
        hours: "0.50",
        workedOn: "2026-06-10T00:00:00.000Z",
      }),
    ).not.toThrow();
  });

  it("rejects hours with more than 2 decimal places", () => {
    expect(() =>
      AdjustTimeEntryInput.parse({
        timeEntryId: "00000000-0000-0000-0000-000000000001",
        hours: "-1.123",
        workedOn: "2026-06-10T00:00:00.000Z",
      }),
    ).toThrow();
  });

  it("rejects non-numeric hours string", () => {
    expect(() =>
      AdjustTimeEntryInput.parse({
        timeEntryId: "00000000-0000-0000-0000-000000000001",
        hours: "abc",
        workedOn: "2026-06-10T00:00:00.000Z",
      }),
    ).toThrow();
  });
});

describe("PromoteWorklogInput schema — contract", () => {
  it("accepts valid non-negative hours string", () => {
    expect(() =>
      PromoteWorklogInput.parse({
        worklogId: "00000000-0000-0000-0000-000000000001",
        hours: "2.50",
      }),
    ).not.toThrow();
  });

  it("rejects hours with more than 2 decimal places", () => {
    expect(() =>
      PromoteWorklogInput.parse({
        worklogId: "00000000-0000-0000-0000-000000000001",
        hours: "1.123",
      }),
    ).toThrow();
  });

  it("rejects negative hours", () => {
    expect(() =>
      PromoteWorklogInput.parse({
        worklogId: "00000000-0000-0000-0000-000000000001",
        hours: "-1.00",
      }),
    ).toThrow();
  });

  it("rejects non-numeric hours string", () => {
    expect(() =>
      PromoteWorklogInput.parse({
        worklogId: "00000000-0000-0000-0000-000000000001",
        hours: "abc",
      }),
    ).toThrow();
  });
});

describe("UpdateTimeEntryInput schema — contract", () => {
  it("accepts valid non-negative hours string", () => {
    expect(() =>
      UpdateTimeEntryInput.parse({
        timeEntryId: "00000000-0000-0000-0000-000000000001",
        hours: "3.50",
      }),
    ).not.toThrow();
  });

  it("rejects hours with more than 2 decimal places", () => {
    expect(() =>
      UpdateTimeEntryInput.parse({
        timeEntryId: "00000000-0000-0000-0000-000000000001",
        hours: "1.123",
      }),
    ).toThrow();
  });

  it("rejects negative hours", () => {
    expect(() =>
      UpdateTimeEntryInput.parse({
        timeEntryId: "00000000-0000-0000-0000-000000000001",
        hours: "-1.00",
      }),
    ).toThrow();
  });

  it("rejects non-numeric hours string", () => {
    expect(() =>
      UpdateTimeEntryInput.parse({
        timeEntryId: "00000000-0000-0000-0000-000000000001",
        hours: "abc",
      }),
    ).toThrow();
  });
});

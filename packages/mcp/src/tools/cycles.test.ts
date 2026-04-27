import { describe, it, expect, vi } from "vitest";
import { closeCycleWithDisposition, normalizeDate } from "./cycles.js";
import type {
  KanonClient,
  KanonCycle,
  KanonCycleDetail,
} from "../kanon-client.js";

// ─── Fixtures ───────────────────────────────────────────────────────────────

const CYCLE_ID = "550e8400-e29b-41d4-a716-446655440001";
const NEXT_CYCLE_ID = "550e8400-e29b-41d4-a716-446655440002";

function makeClosed(overrides: Partial<KanonCycle> = {}): KanonCycle {
  return {
    id: CYCLE_ID,
    name: "Sprint 1",
    goal: null,
    state: "done",
    startDate: "2026-04-01T00:00:00.000Z",
    endDate: "2026-04-14T00:00:00.000Z",
    velocity: 5,
    projectId: "proj_001",
    createdAt: "2026-03-30T00:00:00Z",
    updatedAt: "2026-04-14T00:00:00Z",
    ...overrides,
  };
}

function makeDetail(
  issues: Array<{ id: string; key: string; title: string; state: string; estimate?: number }>,
  overrides: Partial<KanonCycleDetail> = {},
): KanonCycleDetail {
  return {
    id: CYCLE_ID,
    name: "Sprint 1",
    goal: null,
    state: "active",
    startDate: "2026-04-01T00:00:00.000Z",
    endDate: "2026-04-14T00:00:00.000Z",
    velocity: null,
    projectId: "proj_001",
    createdAt: "2026-03-30T00:00:00Z",
    updatedAt: "2026-04-01T00:00:00Z",
    dayIndex: 5,
    days: 14,
    scope: issues.length,
    completed: issues.filter((i) => i.state === "done").length,
    scopeAdded: 0,
    scopeRemoved: 0,
    burnup: [],
    scopeLine: [],
    risks: [],
    issues,
    scopeEvents: [],
    ...overrides,
  };
}

interface MockClient {
  closeCycle: ReturnType<typeof vi.fn>;
  getCycle: ReturnType<typeof vi.fn>;
  attachIssuesToCycle: ReturnType<typeof vi.fn>;
  listCycles: ReturnType<typeof vi.fn>;
}

function makeClient(): MockClient {
  return {
    closeCycle: vi.fn(),
    getCycle: vi.fn(),
    attachIssuesToCycle: vi.fn(),
    listCycles: vi.fn(),
  };
}

// ─── normalizeDate ──────────────────────────────────────────────────────────

describe("normalizeDate", () => {
  it("appends T00:00:00.000Z to YYYY-MM-DD", () => {
    expect(normalizeDate("2026-04-01")).toBe("2026-04-01T00:00:00.000Z");
  });

  it("passes through full ISO datetime unchanged", () => {
    expect(normalizeDate("2026-04-01T12:30:00.000Z")).toBe("2026-04-01T12:30:00.000Z");
  });
});

// ─── closeCycleWithDisposition ──────────────────────────────────────────────

describe("closeCycleWithDisposition — leave", () => {
  it("calls only closeCycle, no detail fetch", async () => {
    const client = makeClient();
    client.closeCycle.mockResolvedValueOnce(makeClosed());

    const result = await closeCycleWithDisposition(client as unknown as KanonClient, {
      cycleId: CYCLE_ID,
      disposition: "leave",
    });

    expect(result).toEqual({
      closed: makeClosed(),
      moved: 0,
      disposition: "leave",
    });
    expect(client.closeCycle).toHaveBeenCalledTimes(1);
    expect(client.getCycle).not.toHaveBeenCalled();
    expect(client.attachIssuesToCycle).not.toHaveBeenCalled();
  });
});

describe("closeCycleWithDisposition — move_to_backlog", () => {
  it("removes incomplete issues, then closes", async () => {
    const client = makeClient();
    const detail = makeDetail([
      { id: "i1", key: "KAN-1", title: "Done", state: "done" },
      { id: "i2", key: "KAN-2", title: "Open", state: "todo" },
      { id: "i3", key: "KAN-3", title: "WIP", state: "in_progress" },
    ]);
    client.getCycle.mockResolvedValueOnce(detail);
    client.attachIssuesToCycle.mockResolvedValueOnce(detail);
    client.closeCycle.mockResolvedValueOnce(makeClosed());

    const result = await closeCycleWithDisposition(client as unknown as KanonClient, {
      cycleId: CYCLE_ID,
      disposition: "move_to_backlog",
      reason: "End of sprint",
    });

    expect(result.moved).toBe(2);
    expect(result.disposition).toBe("move_to_backlog");
    expect(client.attachIssuesToCycle).toHaveBeenCalledWith(CYCLE_ID, {
      remove: ["KAN-2", "KAN-3"],
      reason: "End of sprint",
    });
    expect(client.closeCycle).toHaveBeenCalledWith(CYCLE_ID);
  });

  it("skips attach call when no incomplete issues", async () => {
    const client = makeClient();
    const detail = makeDetail([
      { id: "i1", key: "KAN-1", title: "Done", state: "done" },
    ]);
    client.getCycle.mockResolvedValueOnce(detail);
    client.closeCycle.mockResolvedValueOnce(makeClosed());

    const result = await closeCycleWithDisposition(client as unknown as KanonClient, {
      cycleId: CYCLE_ID,
      disposition: "move_to_backlog",
    });

    expect(result.moved).toBe(0);
    expect(client.attachIssuesToCycle).not.toHaveBeenCalled();
    expect(client.closeCycle).toHaveBeenCalledOnce();
  });
});

describe("closeCycleWithDisposition — move_to_next", () => {
  it("throws clearly when no upcoming cycle exists", async () => {
    const client = makeClient();
    const detail = makeDetail([
      { id: "i2", key: "KAN-2", title: "Open", state: "todo" },
    ]);
    client.getCycle.mockResolvedValueOnce(detail);
    client.listCycles.mockResolvedValueOnce([
      // Only the current cycle — no upcoming
      { ...makeClosed({ state: "active" }) },
    ]);

    await expect(
      closeCycleWithDisposition(client as unknown as KanonClient, {
        cycleId: CYCLE_ID,
        disposition: "move_to_next",
        projectKey: "KAN",
      }),
    ).rejects.toThrow("No upcoming cycle exists");

    expect(client.closeCycle).not.toHaveBeenCalled();
  });

  it("throws when projectKey missing", async () => {
    const client = makeClient();
    const detail = makeDetail([
      { id: "i2", key: "KAN-2", title: "Open", state: "todo" },
    ]);
    client.getCycle.mockResolvedValueOnce(detail);

    await expect(
      closeCycleWithDisposition(client as unknown as KanonClient, {
        cycleId: CYCLE_ID,
        disposition: "move_to_next",
      }),
    ).rejects.toThrow(/projectKey/);
  });

  it("happy path: detaches from current, attaches to next, closes", async () => {
    const client = makeClient();
    const detail = makeDetail([
      { id: "i1", key: "KAN-1", title: "Done", state: "done" },
      { id: "i2", key: "KAN-2", title: "Open", state: "todo" },
    ]);
    client.getCycle.mockResolvedValueOnce(detail);
    client.listCycles.mockResolvedValueOnce([
      // Next upcoming cycle starting after current end
      {
        id: NEXT_CYCLE_ID,
        name: "Sprint 2",
        goal: null,
        state: "upcoming",
        startDate: "2026-04-15T00:00:00.000Z",
        endDate: "2026-04-28T00:00:00.000Z",
        velocity: null,
        projectId: "proj_001",
        createdAt: "",
        updatedAt: "",
      } as KanonCycle,
    ]);
    client.attachIssuesToCycle.mockResolvedValue(detail);
    client.closeCycle.mockResolvedValueOnce(makeClosed());

    const result = await closeCycleWithDisposition(client as unknown as KanonClient, {
      cycleId: CYCLE_ID,
      disposition: "move_to_next",
      projectKey: "KAN",
      reason: "rollover",
    });

    expect(result.moved).toBe(1);
    expect(result.disposition).toBe("move_to_next");
    // First call: remove from current
    expect(client.attachIssuesToCycle).toHaveBeenNthCalledWith(1, CYCLE_ID, {
      remove: ["KAN-2"],
      reason: "rollover",
    });
    // Second call: add to next
    expect(client.attachIssuesToCycle).toHaveBeenNthCalledWith(2, NEXT_CYCLE_ID, {
      add: ["KAN-2"],
      reason: "rollover",
    });
    expect(client.closeCycle).toHaveBeenCalledWith(CYCLE_ID);
  });

  it("picks earliest upcoming cycle by startDate", async () => {
    const client = makeClient();
    const detail = makeDetail([
      { id: "i2", key: "KAN-2", title: "Open", state: "todo" },
    ]);
    client.getCycle.mockResolvedValueOnce(detail);
    client.listCycles.mockResolvedValueOnce([
      {
        id: "later-uuid",
        name: "Sprint 3",
        goal: null,
        state: "upcoming",
        startDate: "2026-05-01T00:00:00.000Z",
        endDate: "2026-05-14T00:00:00.000Z",
        velocity: null,
        projectId: "proj_001",
        createdAt: "",
        updatedAt: "",
      } as KanonCycle,
      {
        id: NEXT_CYCLE_ID,
        name: "Sprint 2",
        goal: null,
        state: "upcoming",
        startDate: "2026-04-15T00:00:00.000Z",
        endDate: "2026-04-28T00:00:00.000Z",
        velocity: null,
        projectId: "proj_001",
        createdAt: "",
        updatedAt: "",
      } as KanonCycle,
    ]);
    client.attachIssuesToCycle.mockResolvedValue(detail);
    client.closeCycle.mockResolvedValueOnce(makeClosed());

    await closeCycleWithDisposition(client as unknown as KanonClient, {
      cycleId: CYCLE_ID,
      disposition: "move_to_next",
      projectKey: "KAN",
    });

    // Earliest matching cycle (NEXT_CYCLE_ID) should be the second arg target
    expect(client.attachIssuesToCycle).toHaveBeenNthCalledWith(2, NEXT_CYCLE_ID, {
      add: ["KAN-2"],
    });
  });
});

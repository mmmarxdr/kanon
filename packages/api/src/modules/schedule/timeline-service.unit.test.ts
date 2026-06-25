/**
 * Unit tests for getProjectScheduleTimeline — bootstrap degrade path (KAN-161).
 *
 * These tests mock the DB layer (prisma) and the forecast service so they can run
 * without a real database. The integration suite covers the happy path end-to-end;
 * this file specifically covers the try/catch degrade branch that the integration
 * harness cannot force without mocking.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock prisma BEFORE importing the service ──────────────────────────────────
// vi.mock is hoisted to the top of the module by Vitest, so this executes before
// any import resolution — the service will receive the mocked prisma instance.
vi.mock("../../config/prisma.js", () => ({
  prisma: {
    issue: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    issueForecast: {
      count: vi.fn(),
    },
    cycle: {
      findFirst: vi.fn(),
    },
    issueDependency: {
      findMany: vi.fn(),
    },
  },
}));

// ── Mock rebuildProjectForecast BEFORE importing the service ──────────────────
vi.mock("../forecast/service.js", () => ({
  rebuildProjectForecast: vi.fn(),
}));

import { prisma } from "../../config/prisma.js";
import { rebuildProjectForecast } from "../forecast/service.js";
import { getProjectScheduleTimeline } from "./timeline-service.js";

// Cast to vi.Mock for type-safe mock control
const mockIssueCount = prisma.issue.count as ReturnType<typeof vi.fn>;
const mockForecastCount = prisma.issueForecast.count as ReturnType<typeof vi.fn>;
const mockIssueFindMany = prisma.issue.findMany as ReturnType<typeof vi.fn>;
const mockCycleFindFirst = prisma.cycle.findFirst as ReturnType<typeof vi.fn>;
const mockDependencyFindMany = prisma.issueDependency.findMany as ReturnType<typeof vi.fn>;
const mockRebuild = rebuildProjectForecast as ReturnType<typeof vi.fn>;

const PROJECT_ID = "00000000-0000-0000-0000-000000000001";

/** Minimal issue row as returned by ISSUE_SELECT. */
const BARE_ISSUE = {
  id: "00000000-0000-0000-0000-000000000002",
  key: "T-1",
  title: "Bare issue",
  state: "backlog",
  type: "task",
  cycleId: null,
  cycle: null,
  schedule: null,
  forecast: null,
  blocks: [],
};

beforeEach(() => {
  vi.clearAllMocks();

  // Default: 1 issue, 0 forecast rows → bootstrap will fire
  mockIssueCount.mockResolvedValue(1);
  mockForecastCount.mockResolvedValue(0);

  // Small-project path: findMany returns the one issue; no active cycle needed.
  mockIssueFindMany.mockResolvedValue([BARE_ISSUE]);
  mockCycleFindFirst.mockResolvedValue(null);
  mockDependencyFindMany.mockResolvedValue([]);
});

describe("getProjectScheduleTimeline — bootstrap degrade path", () => {
  it("STL-UNIT-1: resolves with a plan-only envelope when rebuildProjectForecast throws (KAN-161)", async () => {
    // Force the rebuild to throw — simulates a DB error, FK violation, etc.
    mockRebuild.mockRejectedValue(new Error("simulated forecast engine failure"));

    // The service must NOT propagate the error — it degrades gracefully.
    const result = await getProjectScheduleTimeline(PROJECT_ID);

    // Still a valid envelope
    expect(result).toHaveProperty("rows");
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("truncated");

    // The issue row is present (plan-only — forecast fields are null because
    // the rebuild threw before writing any IssueForecast rows).
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].issueKey).toBe("T-1");

    // Forecast fields are null (no IssueForecast row was written).
    expect(result.rows[0].forecastStart).toBeNull();
    expect(result.rows[0].forecastEnd).toBeNull();
    expect(result.rows[0].slipDays).toBeNull();
    expect(result.rows[0].critical).toBeNull();
  });

  it("STL-UNIT-2: does NOT call rebuildProjectForecast when forecastCount >= issueCount (guard self-limits) (KAN-161)", async () => {
    // Pre-bootstrapped: 1 issue, 1 forecast row → guard is false
    mockIssueCount.mockResolvedValue(1);
    mockForecastCount.mockResolvedValue(1);

    await getProjectScheduleTimeline(PROJECT_ID);

    expect(mockRebuild).not.toHaveBeenCalled();
  });

  it("STL-UNIT-3: does NOT call rebuildProjectForecast when issueCount is 0 (KAN-161)", async () => {
    mockIssueCount.mockResolvedValue(0);
    mockForecastCount.mockResolvedValue(0);
    mockIssueFindMany.mockResolvedValue([]);

    const result = await getProjectScheduleTimeline(PROJECT_ID);

    expect(mockRebuild).not.toHaveBeenCalled();
    expect(result).toEqual({ rows: [], total: 0, truncated: false, projectTotal: 0, unscheduled: 0 });
  });

  it("STL-UNIT-4: calls rebuildProjectForecast with suppressSideEffects:true when forecastCount < issueCount (KAN-161)", async () => {
    // 2 issues, 1 forecast row → partial bootstrap, rebuild should fire
    mockIssueCount.mockResolvedValue(2);
    mockForecastCount.mockResolvedValue(1);
    mockRebuild.mockResolvedValue({ issueCount: 2, criticalCount: 0, worstSlipDays: 0 });

    const secondIssue = { ...BARE_ISSUE, id: "00000000-0000-0000-0000-000000000003", key: "T-2" };
    mockIssueFindMany.mockResolvedValue([BARE_ISSUE, secondIssue]);

    await getProjectScheduleTimeline(PROJECT_ID);

    expect(mockRebuild).toHaveBeenCalledOnce();
    expect(mockRebuild).toHaveBeenCalledWith(PROJECT_ID, { suppressSideEffects: true });
  });
});

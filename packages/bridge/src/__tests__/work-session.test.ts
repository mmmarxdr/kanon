/**
 * Bridge schema tests — WorkLog schemas (S2 / KAN-26)
 *
 * Parse/serialize tests for workLogItemSchema and workLogListResponseSchema.
 */

import { describe, it, expect } from "vitest";
import { workLogItemSchema, workLogListResponseSchema } from "../work-session.js";

const validWorkLogItem = {
  id: "00000000-0000-0000-0000-000000000001",
  startedAt: "2026-06-07T10:00:00.000Z",
  endedAt: "2026-06-07T10:02:00.000Z",
  durationS: 120,
  reason: "stopped" as const,
  via: "claude-code",
  issueId: "00000000-0000-0000-0000-000000000002",
  member: {
    id: "00000000-0000-0000-0000-000000000003",
    username: "alice",
    isAgent: false,
  },
};

describe("workLogItemSchema", () => {
  it("parses a valid WorkLog item", () => {
    const result = workLogItemSchema.parse(validWorkLogItem);
    expect(result.id).toBe(validWorkLogItem.id);
    expect(result.durationS).toBe(120);
    expect(result.reason).toBe("stopped");
    expect(result.via).toBe("claude-code");
    expect(result.member.username).toBe("alice");
  });

  it("accepts via: null", () => {
    const result = workLogItemSchema.parse({ ...validWorkLogItem, via: null });
    expect(result.via).toBeNull();
  });

  it("accepts reason: expired", () => {
    const result = workLogItemSchema.parse({ ...validWorkLogItem, reason: "expired" });
    expect(result.reason).toBe("expired");
  });

  it("rejects unknown reason", () => {
    expect(() =>
      workLogItemSchema.parse({ ...validWorkLogItem, reason: "unknown" }),
    ).toThrow();
  });

  it("rejects negative durationS", () => {
    expect(() =>
      workLogItemSchema.parse({ ...validWorkLogItem, durationS: -1 }),
    ).toThrow();
  });
});

describe("workLogListResponseSchema", () => {
  it("parses a valid list response", () => {
    const payload = {
      worklogs: [validWorkLogItem],
      totalDurationS: 120,
    };
    const result = workLogListResponseSchema.parse(payload);
    expect(result.worklogs).toHaveLength(1);
    expect(result.totalDurationS).toBe(120);
  });

  it("accepts empty worklogs array", () => {
    const result = workLogListResponseSchema.parse({ worklogs: [], totalDurationS: 0 });
    expect(result.worklogs).toHaveLength(0);
    expect(result.totalDurationS).toBe(0);
  });
});

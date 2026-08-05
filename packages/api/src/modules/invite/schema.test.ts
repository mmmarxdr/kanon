import { describe, it, expect } from "vitest";
import { ProjectAssignmentSchema, CreateInviteBody, OnboardingInviteBody } from "./schema.js";

// ── ProjectAssignmentSchema ───────────────────────────────────────────────────

describe("ProjectAssignmentSchema", () => {
  const VALID_UUID = "00000000-0000-0000-0000-000000000001";

  it("accepts all four MemberRole values", () => {
    for (const role of ["viewer", "member", "admin", "owner"] as const) {
      const result = ProjectAssignmentSchema.safeParse({ projectId: VALID_UUID, role });
      expect(result.success, `role '${role}' should be valid`).toBe(true);
    }
  });

  it("rejects an invalid role", () => {
    const result = ProjectAssignmentSchema.safeParse({ projectId: VALID_UUID, role: "superadmin" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-uuid projectId", () => {
    const result = ProjectAssignmentSchema.safeParse({ projectId: "not-a-uuid", role: "member" });
    expect(result.success).toBe(false);
  });

  it("rejects missing projectId", () => {
    const result = ProjectAssignmentSchema.safeParse({ role: "member" });
    expect(result.success).toBe(false);
  });

  it("rejects missing role", () => {
    const result = ProjectAssignmentSchema.safeParse({ projectId: VALID_UUID });
    expect(result.success).toBe(false);
  });
});

// ── projectAssignments on CreateInviteBody ────────────────────────────────────

describe("CreateInviteBody — projectAssignments", () => {
  const P1 = "00000000-0000-0000-0000-000000000001";
  const P2 = "00000000-0000-0000-0000-000000000002";

  it("accepts a body without projectAssignments (existing behavior preserved)", () => {
    const result = CreateInviteBody.safeParse({ role: "member", maxUses: 0, expiresInHours: 48 });
    expect(result.success).toBe(true);
    expect(result.data?.projectAssignments).toBeUndefined();
  });

  it("rejects projectAccess=assigned without projectAssignments", () => {
    const result = CreateInviteBody.safeParse({
      role: "member",
      projectAccess: "assigned",
      expiresInHours: 48,
    });
    expect(result.success).toBe(false);
  });

  it("accepts projectAccess=workspace without assignments", () => {
    const result = CreateInviteBody.safeParse({
      role: "member",
      projectAccess: "workspace",
      expiresInHours: 48,
    });
    expect(result.success).toBe(true);
    expect(result.data?.projectAccess).toBe("workspace");
  });

  it("accepts a body with valid projectAssignments", () => {
    const result = CreateInviteBody.safeParse({
      role: "member",
      maxUses: 0,
      expiresInHours: 48,
      projectAssignments: [{ projectId: P1, role: "member" }, { projectId: P2, role: "viewer" }],
    });
    expect(result.success).toBe(true);
    expect(result.data?.projectAssignments).toHaveLength(2);
  });

  it("deduplicates duplicate projectId entries — first-wins", () => {
    const result = CreateInviteBody.safeParse({
      role: "member",
      maxUses: 0,
      expiresInHours: 48,
      projectAssignments: [
        { projectId: P1, role: "member" },
        { projectId: P1, role: "admin" },   // duplicate — should be dropped
        { projectId: P2, role: "viewer" },
      ],
    });
    expect(result.success).toBe(true);
    const assignments = result.data?.projectAssignments ?? [];
    expect(assignments).toHaveLength(2);
    // P1 kept as member (first-wins), not admin
    const p1Entry = assignments.find((a) => a.projectId === P1);
    expect(p1Entry?.role).toBe("member");
  });

  it("rejects invalid role inside projectAssignments", () => {
    const result = CreateInviteBody.safeParse({
      role: "member",
      maxUses: 0,
      expiresInHours: 48,
      projectAssignments: [{ projectId: P1, role: "god" }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts owner role inside projectAssignments", () => {
    const result = CreateInviteBody.safeParse({
      role: "member",
      maxUses: 0,
      expiresInHours: 48,
      projectAssignments: [{ projectId: P1, role: "owner" }],
    });
    expect(result.success).toBe(true);
  });
});

// ── projectAssignments on OnboardingInviteBody ────────────────────────────────

describe("OnboardingInviteBody — projectAssignments", () => {
  const USER_UUID = "00000000-0000-0000-0000-000000000099";
  const P1 = "00000000-0000-0000-0000-000000000001";
  const P2 = "00000000-0000-0000-0000-000000000002";

  it("accepts a body without projectAssignments (existing behavior preserved)", () => {
    const result = OnboardingInviteBody.safeParse({ userId: USER_UUID, ttlHours: 72, role: "member" });
    expect(result.success).toBe(true);
    expect(result.data?.projectAssignments).toBeUndefined();
  });

  it("accepts a body with valid projectAssignments", () => {
    const result = OnboardingInviteBody.safeParse({
      userId: USER_UUID,
      ttlHours: 24,
      role: "member",
      projectAssignments: [{ projectId: P1, role: "admin" }],
    });
    expect(result.success).toBe(true);
    expect(result.data?.projectAssignments).toHaveLength(1);
  });

  it("deduplicates duplicate projectId entries — first-wins", () => {
    const result = OnboardingInviteBody.safeParse({
      userId: USER_UUID,
      ttlHours: 72,
      role: "member",
      projectAssignments: [
        { projectId: P1, role: "viewer" },
        { projectId: P1, role: "admin" },   // duplicate — should be dropped
        { projectId: P2, role: "member" },
      ],
    });
    expect(result.success).toBe(true);
    const assignments = result.data?.projectAssignments ?? [];
    expect(assignments).toHaveLength(2);
    const p1Entry = assignments.find((a) => a.projectId === P1);
    expect(p1Entry?.role).toBe("viewer");
  });
});

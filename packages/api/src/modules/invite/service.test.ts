import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import { AppError } from "../../shared/types.js";

// ── Prisma mock ───────────────────────────────────────────────────────────────
vi.mock("../../config/prisma.js", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    member: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    workspaceInvite: {
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
    },
    workspace: {
      findUniqueOrThrow: vi.fn(),
    },
    project: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

// ── env mock ──────────────────────────────────────────────────────────────────
vi.mock("../../config/env.js", () => ({
  env: {
    JWT_SECRET: "test-secret-for-invite-service-tests",
    BASE_URL: "http://localhost:3000",
    ONBOARDING_TOKEN_TTL_HOURS: 72,
  },
}));

// ── eventBus mock ─────────────────────────────────────────────────────────────
vi.mock("../../services/event-bus/index.js", () => ({
  eventBus: { emit: vi.fn() },
}));

import { prisma } from "../../config/prisma.js";
import { eventBus } from "../../services/event-bus/index.js";
import {
  createInvite,
  createOnboardingInvite,
  acceptInvite,
  revokeInvite,
  maskEmail,
} from "./service.js";

const mockEmit = eventBus.emit as unknown as ReturnType<typeof vi.fn>;

const mockPrisma = prisma as unknown as {
  user: { findUnique: ReturnType<typeof vi.fn> };
  member: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  workspaceInvite: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
  };
  workspace: { findUniqueOrThrow: ReturnType<typeof vi.fn> };
  project: { findMany: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

// ── Test data ─────────────────────────────────────────────────────────────────
const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "00000000-0000-0000-0000-000000000002";
const CREATED_BY_ID = "00000000-0000-0000-0000-000000000003";
const INVITE_ID = "00000000-0000-0000-0000-000000000004";
const USER_EMAIL = "dev@example.com";

const mockUser = { id: USER_ID, email: USER_EMAIL };
const mockMember = { id: "member-1", userId: USER_ID, workspaceId: WORKSPACE_ID, role: "member" };
const mockInvite = {
  id: INVITE_ID,
  token: "some-opaque-token",
  role: "member",
  maxUses: 1,
  useCount: 0,
  expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
  revokedAt: null,
  label: "Onboarding link",
  email: USER_EMAIL,
  kind: "ONBOARDING",
  consumedAt: null,
  createdAt: new Date(),
  createdBy: { email: "admin@example.com", displayName: "Admin" },
};

describe("createOnboardingInvite()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
    mockPrisma.member.findUnique.mockResolvedValue(mockMember);
    mockPrisma.workspaceInvite.create.mockResolvedValue(mockInvite);
  });

  // C1-T1: happy path — returns { inviteId, url, token, expiresAt }
  it("happy path: returns url, token, expiresAt for valid existing member", async () => {
    const result = await createOnboardingInvite(WORKSPACE_ID, CREATED_BY_ID, {
      userId: USER_ID,
      ttlHours: 72,
      role: "member",
    });

    expect(result).toHaveProperty("inviteId", INVITE_ID);
    expect(result.url).toMatch(/^kanon:\/\//);
    expect(result.url).toContain("onboard?token=");
    expect(result).toHaveProperty("token");
    expect(result).toHaveProperty("expiresAt");

    // The JWT token should decode with scope=onboard and sub=inviteId
    const decoded = jwt.decode(result.token) as Record<string, unknown>;
    expect(decoded["scope"]).toBe("onboard");
    expect(decoded["sub"]).toBe(INVITE_ID);
  });

  // C1-T2: 404 USER_NOT_FOUND when user does not exist
  it("throws 404 USER_NOT_FOUND when user does not exist", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await expect(
      createOnboardingInvite(WORKSPACE_ID, CREATED_BY_ID, {
        userId: USER_ID,
        ttlHours: 72,
        role: "member",
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: "USER_NOT_FOUND",
    });

    expect(mockPrisma.workspaceInvite.create).not.toHaveBeenCalled();
  });

  // C1-T3: 403 NOT_A_MEMBER when user is not a workspace member
  it("throws 403 NOT_A_MEMBER when user is not a workspace member", async () => {
    mockPrisma.member.findUnique.mockResolvedValue(null);

    await expect(
      createOnboardingInvite(WORKSPACE_ID, CREATED_BY_ID, {
        userId: USER_ID,
        ttlHours: 72,
        role: "member",
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "NOT_A_MEMBER",
    });

    expect(mockPrisma.workspaceInvite.create).not.toHaveBeenCalled();
  });

  // C1-T4: TTL respected — expiresAt is ~ttlHours from now
  it("respects ttlHours for expiry calculation", async () => {
    const ttlHours = 24;
    const before = Date.now();

    await createOnboardingInvite(WORKSPACE_ID, CREATED_BY_ID, {
      userId: USER_ID,
      ttlHours,
      role: "member",
    });

    const after = Date.now();

    const createCall = mockPrisma.workspaceInvite.create.mock.calls[0][0];
    const expiresAt: Date = createCall.data.expiresAt;
    const expectedMs = ttlHours * 60 * 60 * 1000;

    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + expectedMs - 100);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(after + expectedMs + 100);
  });

  // C1-T5: invite row has kind=ONBOARDING, maxUses=1, consumedAt=null
  it("creates invite with kind=ONBOARDING, maxUses=1, consumedAt=null", async () => {
    await createOnboardingInvite(WORKSPACE_ID, CREATED_BY_ID, {
      userId: USER_ID,
      ttlHours: 72,
      role: "member",
    });

    const createCall = mockPrisma.workspaceInvite.create.mock.calls[0][0];
    expect(createCall.data.kind).toBe("ONBOARDING");
    expect(createCall.data.maxUses).toBe(1);
    // consumedAt is not set on create (null by default)
    expect(createCall.data.consumedAt).toBeUndefined();
  });
});

// ── createInvite() — project-assignment validation + owner-cap ───────────────

const PROJECT_ID_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PROJECT_ID_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const OTHER_WS_PROJECT_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

const mockInviteCreatedBy = {
  id: INVITE_ID,
  token: "test-token",
  role: "member",
  maxUses: 0,
  useCount: 0,
  expiresAt: new Date(Date.now() + 168 * 60 * 60 * 1000),
  revokedAt: null,
  label: null,
  email: null,
  kind: "MEMBER",
  consumedAt: null,
  projectAssignments: null,
  projectAccess: "workspace" as const,
  createdAt: new Date(),
  createdBy: { email: "admin@example.com", displayName: "Admin" },
  workspace: { name: "Test Workspace" },
};

describe("createInvite() — project-assignment validation + owner-cap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: both projects belong to the workspace
    mockPrisma.project.findMany.mockResolvedValue([
      { id: PROJECT_ID_A },
      { id: PROJECT_ID_B },
    ]);
    mockPrisma.workspaceInvite.create.mockResolvedValue(mockInviteCreatedBy);
  });

  // 2.1-T1: no assignments — existing behavior unchanged, no project lookup
  it("no assignments: creates invite without project validation", async () => {
    const result = await createInvite(
      WORKSPACE_ID,
      CREATED_BY_ID,
      { role: "member", maxUses: 0, expiresInHours: 48 },
      "member",
    );

    expect(mockPrisma.project.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.workspaceInvite.create).toHaveBeenCalledOnce();
    expect(result).toHaveProperty("id");
  });

  // 2.1-T2: valid multi-project — stored on invite
  it("valid assignments: stores projectAssignments JSON on invite", async () => {
    const assignments = [
      { projectId: PROJECT_ID_A, role: "member" as const },
      { projectId: PROJECT_ID_B, role: "viewer" as const },
    ];

    await createInvite(
      WORKSPACE_ID,
      CREATED_BY_ID,
      { role: "member", maxUses: 0, expiresInHours: 48, projectAssignments: assignments },
      "admin",
    );

    expect(mockPrisma.project.findMany).toHaveBeenCalledWith({
      where: { id: { in: [PROJECT_ID_A, PROJECT_ID_B] }, workspaceId: WORKSPACE_ID },
      select: { id: true },
    });
    const createCall = mockPrisma.workspaceInvite.create.mock.calls[0][0];
    expect(createCall.data.projectAssignments).toEqual(assignments);
    expect(createCall.data.projectAccess).toBe("assigned");
  });

  // 2.1-T3: projectId from another workspace → 422 INVALID_PROJECT, no invite persisted
  it("out-of-workspace projectId → 422 INVALID_PROJECT, no invite created", async () => {
    // Only PROJECT_ID_A belongs to workspace; OTHER_WS_PROJECT_ID does not
    mockPrisma.project.findMany.mockResolvedValue([{ id: PROJECT_ID_A }]);

    await expect(
      createInvite(
        WORKSPACE_ID,
        CREATED_BY_ID,
        {
          role: "member",
          maxUses: 0,
          expiresInHours: 48,
          projectAssignments: [
            { projectId: PROJECT_ID_A, role: "member" },
            { projectId: OTHER_WS_PROJECT_ID, role: "viewer" },
          ],
        },
        "admin",
      ),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: "INVALID_PROJECT",
    });

    expect(mockPrisma.workspaceInvite.create).not.toHaveBeenCalled();
  });

  // 2.1-T4: role:'owner' with admin inviter → 403 ROLE_CAP_EXCEEDED, no invite persisted
  it("role:owner by admin inviter → 403 ROLE_CAP_EXCEEDED, no invite created", async () => {
    mockPrisma.project.findMany.mockResolvedValue([{ id: PROJECT_ID_A }]);

    await expect(
      createInvite(
        WORKSPACE_ID,
        CREATED_BY_ID,
        {
          role: "member",
          maxUses: 0,
          expiresInHours: 48,
          projectAssignments: [{ projectId: PROJECT_ID_A, role: "owner" }],
        },
        "admin", // inviterRole
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "ROLE_CAP_EXCEEDED",
    });

    expect(mockPrisma.workspaceInvite.create).not.toHaveBeenCalled();
  });

  // 2.1-T5: role:'owner' by ws-owner → invite persisted
  it("role:owner by owner inviter → invite created successfully", async () => {
    mockPrisma.project.findMany.mockResolvedValue([{ id: PROJECT_ID_A }]);

    await expect(
      createInvite(
        WORKSPACE_ID,
        CREATED_BY_ID,
        {
          role: "member",
          maxUses: 0,
          expiresInHours: 48,
          projectAssignments: [{ projectId: PROJECT_ID_A, role: "owner" }],
        },
        "owner", // inviterRole — allowed
      ),
    ).resolves.toHaveProperty("id");

    expect(mockPrisma.workspaceInvite.create).toHaveBeenCalledOnce();
  });
});

// ── createOnboardingInvite() — project-assignment validation + owner-cap ──────

describe("createOnboardingInvite() — project-assignment validation + owner-cap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
    mockPrisma.member.findUnique.mockResolvedValue(mockMember);
    mockPrisma.workspaceInvite.create.mockResolvedValue(mockInvite);
    mockPrisma.project.findMany.mockResolvedValue([{ id: PROJECT_ID_A }]);
  });

  // 2.3-T1: out-of-workspace projectId → 422 INVALID_PROJECT, no invite persisted
  it("out-of-workspace projectId → 422 INVALID_PROJECT, no invite created", async () => {
    mockPrisma.project.findMany.mockResolvedValue([]); // no matching projects

    await expect(
      createOnboardingInvite(
        WORKSPACE_ID,
        CREATED_BY_ID,
        {
          userId: USER_ID,
          ttlHours: 72,
          role: "member",
          projectAssignments: [{ projectId: OTHER_WS_PROJECT_ID, role: "viewer" }],
        },
        "admin",
      ),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: "INVALID_PROJECT",
    });

    expect(mockPrisma.workspaceInvite.create).not.toHaveBeenCalled();
  });

  // 2.3-T2: role:'owner' with admin inviter → 403 ROLE_CAP_EXCEEDED
  it("role:owner by admin inviter → 403 ROLE_CAP_EXCEEDED, no invite created", async () => {
    await expect(
      createOnboardingInvite(
        WORKSPACE_ID,
        CREATED_BY_ID,
        {
          userId: USER_ID,
          ttlHours: 72,
          role: "member",
          projectAssignments: [{ projectId: PROJECT_ID_A, role: "owner" }],
        },
        "admin",
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "ROLE_CAP_EXCEEDED",
    });

    expect(mockPrisma.workspaceInvite.create).not.toHaveBeenCalled();
  });

  // 2.3-T3: role:'owner' by ws-owner → invite persisted
  it("role:owner by owner inviter → invite created successfully", async () => {
    await expect(
      createOnboardingInvite(
        WORKSPACE_ID,
        CREATED_BY_ID,
        {
          userId: USER_ID,
          ttlHours: 72,
          role: "member",
          projectAssignments: [{ projectId: PROJECT_ID_A, role: "owner" }],
        },
        "owner",
      ),
    ).resolves.toHaveProperty("inviteId");

    expect(mockPrisma.workspaceInvite.create).toHaveBeenCalledOnce();
  });

  // 2.3-T4: valid assignments stored on invite
  it("valid assignments: stored as projectAssignments JSON on invite", async () => {
    const assignments = [{ projectId: PROJECT_ID_A, role: "member" as const }];

    await createOnboardingInvite(
      WORKSPACE_ID,
      CREATED_BY_ID,
      {
        userId: USER_ID,
        ttlHours: 72,
        role: "member",
        projectAssignments: assignments,
      },
      "admin",
    );

    const createCall = mockPrisma.workspaceInvite.create.mock.calls[0][0];
    expect(createCall.data.projectAssignments).toEqual(assignments);
  });
});

// ── acceptInvite() — kind guard ───────────────────────────────────────────────

/**
 * Build a mock Prisma transaction object that simulates the raw SQL path.
 * acceptInvite uses $queryRaw inside $transaction — we wire $transaction to
 * invoke the callback with a mock tx that returns the row we specify.
 */
function makeTx(row: Record<string, unknown> | null, workspaceRow?: {
  id: string;
  name: string;
  allowedDomains: string[];
}) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue(row ? [row] : []),
    workspace: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(workspaceRow ?? {
        id: WORKSPACE_ID,
        name: "Test Workspace",
        allowedDomains: [],
      }),
    },
    member: {
      findUnique: vi.fn().mockResolvedValue(null),       // not yet a member
      create: vi.fn().mockResolvedValue({
        id: "member-new",
        username: "dev",
        role: "MEMBER",
        userId: USER_ID,
        workspaceId: WORKSPACE_ID,
        user: { email: USER_EMAIL, displayName: null, avatarUrl: null },
      }),
    },
    workspaceInvite: {
      update: vi.fn().mockResolvedValue({}),
    },
  };
  return tx;
}

// Base row for a standard MEMBER invite (valid, not expired, not revoked)
const BASE_MEMBER_ROW = {
  id: INVITE_ID,
  token: "member-token",
  role: "MEMBER",
  max_uses: 10,
  use_count: 0,
  expires_at: new Date(Date.now() + 72 * 60 * 60 * 1000),
  revoked_at: null,
  workspace_id: WORKSPACE_ID,
  kind: "MEMBER",
  project_access: "workspace",
  project_assignments: null,
  email: null,
};

const PROJECT_ID_C = "dddddddd-dddd-dddd-dddd-dddddddddddd";

/**
 * Extended tx mock that includes project + projectMember for PM-creation tests.
 * Used in Phase 5 acceptInvite tests. The base makeTx lacks these; adding here
 * keeps the existing E1 tests untouched.
 */
function makeTxWithPM(
  row: Record<string, unknown> | null,
  opts: {
    liveProjectIds?: string[];
    pmCreateError?: Error;
  } = {},
) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue(row ? [row] : []),
    workspace: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: WORKSPACE_ID,
        name: "Test Workspace",
        allowedDomains: [],
      }),
    },
    member: {
      findUnique: vi.fn().mockResolvedValue(null), // not yet a member
      create: vi.fn().mockResolvedValue({
        id: "member-new",
        username: "dev",
        role: "MEMBER",
        userId: USER_ID,
        workspaceId: WORKSPACE_ID,
        user: { email: USER_EMAIL, displayName: null, avatarUrl: null },
      }),
    },
    workspaceInvite: {
      update: vi.fn().mockResolvedValue({}),
    },
    project: {
      findMany: vi.fn().mockResolvedValue(
        (opts.liveProjectIds ?? []).map((id) => ({ id })),
      ),
    },
    projectMember: {
      createMany: opts.pmCreateError
        ? vi.fn().mockRejectedValue(opts.pmCreateError)
        : vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  return tx;
}

// Base row with project_assignments (for Phase 5 tests)
const BASE_MEMBER_ROW_WITH_ASSIGNMENTS = {
  ...BASE_MEMBER_ROW,
  project_access: "assigned",
  project_assignments: [
    { projectId: PROJECT_ID_A, role: "member" },
    { projectId: PROJECT_ID_B, role: "viewer" },
  ],
};

describe("acceptInvite() — kind guard (E1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // E1-T1 (S5.9): ONBOARDING invite → 400 INVALID_INVITE_KIND, no Member created
  it("rejects an ONBOARDING invite with 400 INVALID_INVITE_KIND", async () => {
    const onboardingRow = { ...BASE_MEMBER_ROW, kind: "ONBOARDING", token: "onboarding-token" };
    const tx = makeTx(onboardingRow);
    mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof tx) => Promise<unknown>) => cb(tx));

    await expect(
      acceptInvite("onboarding-token", USER_ID, USER_EMAIL),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "INVALID_INVITE_KIND",
    });

    // No Member row must be created
    expect(tx.member.create).not.toHaveBeenCalled();
    // useCount must NOT be incremented
    expect(tx.workspaceInvite.update).not.toHaveBeenCalled();
  });

  // E1-T2 (regression): MEMBER invite still works end-to-end
  it("accepts a MEMBER invite and creates a member row (regression)", async () => {
    const tx = makeTx(BASE_MEMBER_ROW);
    mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof tx) => Promise<unknown>) => cb(tx));

    const result = await acceptInvite("member-token", USER_ID, USER_EMAIL);

    expect(tx.member.create).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ username: "dev", role: "MEMBER" });
  });

  // E1-T3 (regression): invite with no kind field (undefined) still works — existing rows
  it("accepts an invite where kind is undefined (pre-migration row, treated as MEMBER)", async () => {
    const legacyRow = { ...BASE_MEMBER_ROW, kind: undefined };
    const tx = makeTx(legacyRow);
    mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof tx) => Promise<unknown>) => cb(tx));

    const result = await acceptInvite("member-token", USER_ID, USER_EMAIL);

    expect(tx.member.create).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ username: "dev" });
  });

  // E1-T4 (regression safeguard): null project_assignments → no PM creation, no error
  it("null project_assignments → no PM creation attempt (regression: existing invites)", async () => {
    const rowWithNull = { ...BASE_MEMBER_ROW, project_assignments: null };
    const tx = makeTxWithPM(rowWithNull, { liveProjectIds: [] });
    mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof tx) => Promise<unknown>) => cb(tx));

    const result = await acceptInvite("member-token", USER_ID, USER_EMAIL);

    expect(tx.member.create).toHaveBeenCalledOnce();
    expect(tx.projectMember.createMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({ username: "dev" });
  });
});

// ── acceptInvite() — project assignment application (Phase 5) ─────────────────

describe("acceptInvite() — project assignment application (Phase 5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 5.1-T1: project_assignments in raw SELECT row → helper called with userId (not Member.id)
  it("5.1-T1: assignments in row → createProjectMembersInTx called with invitee userId", async () => {
    const tx = makeTxWithPM(BASE_MEMBER_ROW_WITH_ASSIGNMENTS, {
      liveProjectIds: [PROJECT_ID_A, PROJECT_ID_B],
    });
    mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof tx) => Promise<unknown>) => cb(tx));

    await acceptInvite("member-token", USER_ID, USER_EMAIL);

    expect(tx.projectMember.createMany).toHaveBeenCalledOnce();
    const call = tx.projectMember.createMany.mock.calls[0][0];
    // All rows must carry the invitee's userId, not member-new (Member.id)
    for (const row of call.data) {
      expect(row.userId).toBe(USER_ID);
    }
    expect(call.skipDuplicates).toBe(true);
  });

  // 5.1-T2: invite with no assignments → only Member created, no PM rows
  it("5.1-T2: invite with no assignments → no PM creation", async () => {
    const rowNoAssignments = {
      ...BASE_MEMBER_ROW_WITH_ASSIGNMENTS,
      project_assignments: null,
    };
    const tx = makeTxWithPM(rowNoAssignments, { liveProjectIds: [] });
    mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof tx) => Promise<unknown>) => cb(tx));

    await acceptInvite("member-token", USER_ID, USER_EMAIL);

    expect(tx.member.create).toHaveBeenCalledOnce();
    expect(tx.projectMember.createMany).not.toHaveBeenCalled();
  });

  // 5.1-T3: stale project skipped — helper filters via project.findMany
  it("5.1-T3: stale project in assignments → skipped (helper does the filtering)", async () => {
    const rowWithStale = {
      ...BASE_MEMBER_ROW_WITH_ASSIGNMENTS,
      project_assignments: [
        { projectId: PROJECT_ID_A, role: "member" },
        { projectId: PROJECT_ID_C, role: "viewer" }, // stale
      ],
    };
    const tx = makeTxWithPM(rowWithStale, {
      liveProjectIds: [PROJECT_ID_A], // PROJECT_ID_C filtered out
    });
    mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof tx) => Promise<unknown>) => cb(tx));

    await acceptInvite("member-token", USER_ID, USER_EMAIL);

    // createMany called with only the live project
    expect(tx.projectMember.createMany).toHaveBeenCalledWith({
      data: [{ userId: USER_ID, projectId: PROJECT_ID_A, role: "member" }],
      skipDuplicates: true,
    });
    // Member still created (accept succeeds despite stale project)
    expect(tx.member.create).toHaveBeenCalledOnce();
  });

  // 5.4: atomic boundary — PM failure rolls back Member (tx throws → member not committed)
  it("5.4: PM createMany failure → transaction throws (Member not committed)", async () => {
    const tx = makeTxWithPM(BASE_MEMBER_ROW_WITH_ASSIGNMENTS, {
      liveProjectIds: [PROJECT_ID_A, PROJECT_ID_B],
      pmCreateError: new Error("DB constraint failure"),
    });
    mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof tx) => Promise<unknown>) => cb(tx));

    await expect(
      acceptInvite("member-token", USER_ID, USER_EMAIL),
    ).rejects.toThrow("DB constraint failure");
  });
});

// ── KAN-76: invite token must never reach the SSE event-bus payload ───────────

describe("invite events — token leak guard (KAN-76)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // createInvite emits invite.created without the raw token, with masked email
  it("createInvite: invite.created payload omits token and masks email", async () => {
    mockPrisma.project.findMany.mockResolvedValue([]);
    mockPrisma.workspaceInvite.create.mockResolvedValue({
      ...mockInviteCreatedBy,
      email: "jane.doe@example.com",
    });

    await createInvite(
      WORKSPACE_ID,
      CREATED_BY_ID,
      { role: "member", maxUses: 0, expiresInHours: 48 },
      "member",
    );

    expect(mockEmit).toHaveBeenCalledOnce();
    const event = mockEmit.mock.calls[0][0];
    expect(event.type).toBe("invite.created");
    expect(event.payload).not.toHaveProperty("token");
    expect(event.payload).toMatchObject({
      inviteId: INVITE_ID,
      role: "member",
      email: "j***@example.com",
    });
  });

  // link invites (no email) → email is null, never the token
  it("createInvite: link invite (no email) → payload email is null", async () => {
    mockPrisma.project.findMany.mockResolvedValue([]);
    mockPrisma.workspaceInvite.create.mockResolvedValue(mockInviteCreatedBy); // email: null

    await createInvite(
      WORKSPACE_ID,
      CREATED_BY_ID,
      { role: "member", maxUses: 0, expiresInHours: 48 },
      "member",
    );

    const event = mockEmit.mock.calls[0][0];
    expect(event.payload).not.toHaveProperty("token");
    expect(event.payload.email).toBeNull();
  });

  // revokeInvite emits invite.revoked without the raw token, with masked email
  it("revokeInvite: invite.revoked payload omits token and masks email", async () => {
    mockPrisma.workspaceInvite.findFirst.mockResolvedValue({
      id: INVITE_ID,
      role: "member",
      revokedAt: null,
    });
    mockPrisma.workspaceInvite.update.mockResolvedValue({
      ...mockInviteCreatedBy,
      email: "jane.doe@example.com",
      token: "super-secret-token",
      revokedAt: new Date(),
    });

    await revokeInvite(INVITE_ID, WORKSPACE_ID, CREATED_BY_ID);

    expect(mockEmit).toHaveBeenCalledOnce();
    const event = mockEmit.mock.calls[0][0];
    expect(event.type).toBe("invite.revoked");
    expect(event.payload).not.toHaveProperty("token");
    expect(event.payload).toMatchObject({
      inviteId: INVITE_ID,
      role: "member",
      email: "j***@example.com",
    });
  });
});

// ── maskEmail() — PII masking helper (KAN-76) ─────────────────────────────────

describe("maskEmail()", () => {
  it("masks the local-part, keeps first char and full domain", () => {
    expect(maskEmail("jane.doe@example.com")).toBe("j***@example.com");
  });

  it("does not leak local-part length (single-char local-part)", () => {
    expect(maskEmail("a@example.com")).toBe("a***@example.com");
  });

  it("returns null for null/undefined/empty (link invites)", () => {
    expect(maskEmail(null)).toBeNull();
    expect(maskEmail(undefined)).toBeNull();
    expect(maskEmail("")).toBeNull();
  });

  it("returns a fully-masked sentinel for malformed input (no/leading @)", () => {
    expect(maskEmail("not-an-email")).toBe("***");
    expect(maskEmail("@example.com")).toBe("***");
  });
});

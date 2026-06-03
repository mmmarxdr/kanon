import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import { createHash, randomBytes } from "node:crypto";
import {
  hashPassword,
  verifyPassword,
  signTokens,
  verifyRefreshToken,
  signAccessToken,
} from "./service.js";
import { AppError } from "../../shared/types.js";

// ── Prisma mock (for onboard + exchange tests) ─────────────────────────────
vi.mock("../../config/prisma.js", () => ({
  prisma: {
    workspaceInvite: {
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    member: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    refreshToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

// ── env mock ───────────────────────────────────────────────────────────────
vi.mock("../../config/env.js", () => ({
  env: {
    JWT_SECRET: "test-jwt-secret-32-chars-minimum!",
    JWT_REFRESH_SECRET: "test-refresh-secret-32-chars-min!",
    BASE_URL: "http://localhost:3000",
    ONBOARDING_TOKEN_TTL_HOURS: 72,
  },
}));

import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";
import { onboard, exchange, sha256Hex, issueRefreshFromLogin } from "./service.js";

describe("Auth Service — unit tests (no DB)", () => {
  // ── Password hashing ───────────────────────────────────────────────

  describe("hashPassword / verifyPassword", () => {
    it("hashes a password and verifies it", async () => {
      const hash = await hashPassword("Secret123!");
      expect(hash).not.toBe("Secret123!");
      expect(hash.startsWith("$2")).toBe(true); // bcrypt prefix

      const valid = await verifyPassword("Secret123!", hash);
      expect(valid).toBe(true);
    });

    it("rejects wrong password", async () => {
      const hash = await hashPassword("Secret123!");
      const valid = await verifyPassword("WrongPassword!", hash);
      expect(valid).toBe(false);
    });

    it("produces different hashes for the same input (salted)", async () => {
      const h1 = await hashPassword("Secret123!");
      const h2 = await hashPassword("Secret123!");
      expect(h1).not.toBe(h2);
    });
  });

  // ── Token signing ─────────────────────────────────────────────────

  describe("signTokens", () => {
    it("returns accessToken and refreshToken", () => {
      const result = signTokens({
        sub: "user-1",
        email: "user@kanon.io",
      });

      expect(result).toHaveProperty("accessToken");
      expect(result).toHaveProperty("refreshToken");
      expect(typeof result.accessToken).toBe("string");
      expect(typeof result.refreshToken).toBe("string");
    });

    it("access token contains expected payload (sub + email only)", () => {
      const { accessToken } = signTokens({
        sub: "user-1",
        email: "user@kanon.io",
      });

      const decoded = jwt.decode(accessToken) as Record<string, unknown>;
      expect(decoded["sub"]).toBe("user-1");
      expect(decoded["email"]).toBe("user@kanon.io");
      expect(decoded).toHaveProperty("exp");
      // Must NOT contain workspace or role
      expect(decoded).not.toHaveProperty("workspaceId");
      expect(decoded).not.toHaveProperty("role");
    });

    it("refresh token contains expected payload", () => {
      const { refreshToken } = signTokens({
        sub: "user-1",
        email: "user@kanon.io",
      });

      const decoded = jwt.decode(refreshToken) as Record<string, unknown>;
      expect(decoded["sub"]).toBe("user-1");
      expect(decoded["email"]).toBe("user@kanon.io");
      // Must NOT contain workspace or role
      expect(decoded).not.toHaveProperty("workspaceId");
      expect(decoded).not.toHaveProperty("role");
    });
  });

  // ── Refresh token verification ────────────────────────────────────

  describe("verifyRefreshToken", () => {
    it("verifies a valid refresh token", () => {
      const { refreshToken } = signTokens({
        sub: "user-1",
        email: "user@kanon.io",
      });

      const payload = verifyRefreshToken(refreshToken);
      expect(payload.sub).toBe("user-1");
      expect(payload.email).toBe("user@kanon.io");
    });

    it("throws AppError for invalid token", () => {
      expect(() => verifyRefreshToken("invalid.jwt.token")).toThrow(AppError);

      try {
        verifyRefreshToken("invalid.jwt.token");
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(401);
        expect((err as AppError).code).toBe("INVALID_REFRESH_TOKEN");
      }
    });

    it("throws AppError for token signed with wrong secret", () => {
      const fakeToken = jwt.sign(
        { sub: "user-1", email: "user@kanon.io" },
        "wrong-secret-that-is-long-enough",
        { expiresIn: "7d" },
      );

      expect(() => verifyRefreshToken(fakeToken)).toThrow(AppError);
    });
  });
});

// ── sha256Hex helper ──────────────────────────────────────────────────────────

describe("sha256Hex()", () => {
  it("returns a lowercase hex string", () => {
    const result = sha256Hex("hello");
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matches Node crypto output", () => {
    const expected = createHash("sha256").update("test-input").digest("hex");
    expect(sha256Hex("test-input")).toBe(expected);
  });
});

// ── Test constants ────────────────────────────────────────────────────────────

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "00000000-0000-0000-0000-000000000002";
const INVITE_ID = "00000000-0000-0000-0000-000000000003";
const USER_EMAIL = "dev@example.com";

const mockPrisma = prisma as unknown as {
  workspaceInvite: {
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  user: { findUnique: ReturnType<typeof vi.fn> };
  member: { findUnique: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
  refreshToken: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
};

// Helper: build a valid onboarding JWT
function makeOnboardToken(overrides: Record<string, unknown> = {}): string {
  return jwt.sign(
    { sub: INVITE_ID, scope: "onboard", ...overrides },
    env.JWT_SECRET,
    { expiresIn: "72h" },
  );
}

// ── onboard() tests ───────────────────────────────────────────────────────────

describe("onboard()", () => {
  const mockInvite = {
    id: INVITE_ID,
    kind: "ONBOARDING",
    email: USER_EMAIL,
    workspaceId: WORKSPACE_ID,
    role: "member",
    projectAssignments: null,
    revokedAt: null,
    consumedAt: null,
    expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
    workspace: { id: WORKSPACE_ID, name: "Test WS", slug: "test-ws" },
  };

  const mockUser = {
    id: USER_ID,
    email: USER_EMAIL,
    workspaces: [],
  };

  const mockMember = {
    id: "member-id-1",
    userId: USER_ID,
    workspaceId: WORKSPACE_ID,
    role: "member",
    workspace: { id: WORKSPACE_ID, name: "Test WS", slug: "test-ws" },
  };

  const mockRefreshTokenRow = {
    id: "refresh-token-row-1",
    tokenHash: "hash",
    userId: USER_ID,
    workspaceId: WORKSPACE_ID,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  };

  /** Raw row shape returned by SELECT ... FOR UPDATE in onboard() */
  const mockRawRow = {
    id: INVITE_ID,
    kind: "ONBOARDING",
    email: USER_EMAIL,
    workspace_id: WORKSPACE_ID,
    role: "member",
    project_assignments: null,
    revoked_at: null,
    consumed_at: null,
    expires_at: new Date(Date.now() + 72 * 60 * 60 * 1000),
  };

  const mockWorkspace = { id: WORKSPACE_ID, name: "Test WS", slug: "test-ws" };

  function buildDefaultTx(overrides: { rawRow?: object | null; updateFn?: ReturnType<typeof vi.fn> } = {}) {
    const rawRow = overrides.rawRow !== undefined ? overrides.rawRow : mockRawRow;
    return {
      // KAN-37: SELECT ... FOR UPDATE — returns raw rows
      $queryRaw: vi.fn().mockResolvedValue(rawRow === null ? [] : [rawRow]),
      workspaceInvite: {
        update: overrides.updateFn ?? vi.fn().mockResolvedValue(mockInvite),
      },
      workspace: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(mockWorkspace),
      },
      user: {
        upsert: vi.fn().mockResolvedValue(mockUser),
      },
      member: {
        findUnique: vi.fn().mockResolvedValue(mockMember),
        create: vi.fn().mockResolvedValue(mockMember),
      },
      refreshToken: {
        create: vi.fn().mockResolvedValue(mockRefreshTokenRow),
      },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    // $transaction executes the callback with a tx proxy
    mockPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      const tx = buildDefaultTx();
      return cb(tx);
    });
  });

  // D1: happy path
  it("happy path: returns refreshToken, apiUrl, workspace, email, expiresAt", async () => {
    const token = makeOnboardToken();
    const result = await onboard(token);

    expect(result).toHaveProperty("refreshToken");
    expect(typeof result.refreshToken).toBe("string");
    expect(result.refreshToken.length).toBeGreaterThan(10);
    expect(result.apiUrl).toBe(env.BASE_URL);
    expect(result.workspace).toMatchObject({ id: WORKSPACE_ID, name: "Test WS", slug: "test-ws" });
    expect(result.email).toBe(USER_EMAIL);
    expect(result).toHaveProperty("expiresAt");
  });

  // D2: JWT invalid → 400
  it("throws 400 INVALID_TOKEN for a malformed JWT", async () => {
    await expect(onboard("not.a.jwt")).rejects.toMatchObject({
      statusCode: 400,
      code: "INVALID_TOKEN",
    });
  });

  // D2: JWT expired → 410
  it("throws 410 TOKEN_EXPIRED for an expired JWT", async () => {
    const expired = jwt.sign(
      { sub: INVITE_ID, scope: "onboard" },
      env.JWT_SECRET,
      { expiresIn: "-1s" },
    );

    await expect(onboard(expired)).rejects.toMatchObject({
      statusCode: 410,
      code: "TOKEN_EXPIRED",
    });
  });

  // D2: wrong scope → 400 INVALID_TOKEN
  it("throws 400 INVALID_TOKEN for wrong scope claim", async () => {
    const wrongScope = makeOnboardToken({ scope: "access" });

    await expect(onboard(wrongScope)).rejects.toMatchObject({
      statusCode: 400,
      code: "INVALID_TOKEN",
    });
  });

  // D2: invite already consumed → 410
  // KAN-37: The FOR UPDATE lock means the second concurrent transaction sees consumed_at≠null
  // after the first commits. In the unit test we simulate this by returning a row with consumed_at set.
  it("throws 410 TOKEN_CONSUMED when FOR UPDATE sees consumed_at already set (race loser)", async () => {
    mockPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      const tx = buildDefaultTx({
        rawRow: { ...mockRawRow, consumed_at: new Date() }, // lock sees already-consumed row
      });
      return cb(tx);
    });

    const token = makeOnboardToken();
    await expect(onboard(token)).rejects.toMatchObject({
      statusCode: 410,
      code: "TOKEN_CONSUMED",
    });
  });

  // D2: invite revoked → 400 TOKEN_REVOKED
  it("throws 400 TOKEN_REVOKED when invite is revoked", async () => {
    mockPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      const tx = buildDefaultTx({
        rawRow: { ...mockRawRow, revoked_at: new Date() },
      });
      return cb(tx);
    });

    const token = makeOnboardToken();
    await expect(onboard(token)).rejects.toMatchObject({
      statusCode: 400,
      code: "TOKEN_REVOKED",
    });
  });

  // D2 (create-on-consume): user.upsert creates User if absent — no USER_NOT_FOUND error
  // D2 (create-on-consume): member is find-or-created — no NOT_A_MEMBER error
  // Both old error paths removed; new behavior tested in integration tests.

  // D1 atomicity: if refreshToken.create throws, the whole transaction rolls back.
  // KAN-37: consumedAt is set via update inside the locked tx BEFORE refreshToken.create.
  // In real Postgres, the tx rollback undoes the update. Unit test verifies error propagates.
  it("does not commit when inner step fails (atomic — integration verified)", async () => {
    mockPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      const tx = {
        ...buildDefaultTx(),
        refreshToken: {
          create: vi.fn().mockRejectedValue(new Error("DB write failure")),
        },
      };
      return cb(tx);
    });

    const token = makeOnboardToken();
    await expect(onboard(token)).rejects.toThrow("DB write failure");
  });
});

// ── onboard() — project assignment application (Phase 6) ─────────────────────

describe("onboard() — project assignment application (Phase 6)", () => {
  const PROJECT_ID_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const PROJECT_ID_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

  const mockInviteWithAssignments = {
    id: INVITE_ID,
    kind: "ONBOARDING",
    email: USER_EMAIL,
    workspaceId: WORKSPACE_ID,
    role: "member",
    revokedAt: null,
    consumedAt: null,
    expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
    workspace: { id: WORKSPACE_ID, name: "Test WS", slug: "test-ws" },
    projectAssignments: [
      { projectId: PROJECT_ID_A, role: "member" },
      { projectId: PROJECT_ID_B, role: "viewer" },
    ],
  };

  const mockUser = { id: USER_ID, email: USER_EMAIL };

  const mockMember = {
    id: "member-id-99", // different from USER_ID — must NOT appear in PM rows
    userId: USER_ID,
    workspaceId: WORKSPACE_ID,
    role: "member",
    workspace: { id: WORKSPACE_ID, name: "Test WS", slug: "test-ws" },
  };

  const mockRefreshTokenRow = {
    id: "refresh-token-row-1",
    tokenHash: "hash",
    userId: USER_ID,
    workspaceId: WORKSPACE_ID,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  };

  function makeOnboardTxWithPM(opts: {
    invite?: {
      id?: string; kind?: string; email?: string; workspace_id?: string;
      role?: string; project_assignments?: unknown; revoked_at?: Date | null;
      consumed_at?: Date | null; expires_at?: Date;
    };
    liveProjectIds?: string[];
    pmCreateError?: Error;
  } = {}) {
    const rawInvite = {
      id: INVITE_ID,
      kind: "ONBOARDING",
      email: USER_EMAIL,
      workspace_id: WORKSPACE_ID,
      role: "member",
      project_assignments: mockInviteWithAssignments.projectAssignments,
      revoked_at: null,
      consumed_at: null,
      expires_at: mockInviteWithAssignments.expiresAt,
      ...opts.invite,
    };
    const liveProjectIds = opts.liveProjectIds ?? [PROJECT_ID_A, PROJECT_ID_B];
    const updateFn = vi.fn().mockResolvedValue({});
    const pmCreateFn = opts.pmCreateError
      ? vi.fn().mockRejectedValue(opts.pmCreateError)
      : vi.fn().mockResolvedValue({ count: liveProjectIds.length });
    const tx = {
      // KAN-37: FOR UPDATE via $queryRaw
      $queryRaw: vi.fn().mockResolvedValue([rawInvite]),
      workspaceInvite: {
        update: updateFn,
      },
      workspace: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: WORKSPACE_ID, name: "Test WS", slug: "test-ws" }),
      },
      user: { upsert: vi.fn().mockResolvedValue(mockUser) },
      member: {
        findUnique: vi.fn().mockResolvedValue(mockMember),
        create: vi.fn().mockResolvedValue(mockMember),
      },
      refreshToken: { create: vi.fn().mockResolvedValue(mockRefreshTokenRow) },
      project: {
        findMany: vi.fn().mockResolvedValue(liveProjectIds.map((id) => ({ id }))),
      },
      projectMember: {
        createMany: pmCreateFn,
      },
    };
    return { tx, updateFn, pmCreateFn };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 6.1-T1: createProjectMembersInTx called inside existing tx (not a second tx)
  it("6.1-T1: PM helper called inside existing tx; no second $transaction", async () => {
    const { tx } = makeOnboardTxWithPM();
    mockPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    const token = makeOnboardToken();
    await onboard(token);

    // PM rows were created
    expect(tx.projectMember.createMany).toHaveBeenCalledOnce();
    const call = tx.projectMember.createMany.mock.calls[0][0];
    expect(call.skipDuplicates).toBe(true);

    // $transaction was called exactly once — no second transaction
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  // 6.1-T2: userId discipline — PM rows carry user.id, NOT member.id
  it("6.1-T2: PM rows carry invitee user.id, not member.id", async () => {
    const { tx } = makeOnboardTxWithPM();
    mockPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    const token = makeOnboardToken();
    await onboard(token);

    const call = tx.projectMember.createMany.mock.calls[0][0];
    for (const row of call.data) {
      expect(row.userId).toBe(USER_ID);
      expect(row.userId).not.toBe("member-id-99"); // must NOT be Member.id
    }
  });

  // 6.1-T3: consumedAt NOT committed when PM creation fails (atomic boundary).
  // KAN-37: The CAS (updateMany) runs BEFORE PM creation inside the tx.
  // In real Postgres, a tx rollback undoes the updateMany write.
  // In unit tests (mocked tx), we verify the overall call rejects so real-DB
  // integration tests can assert the rollback behavior end-to-end.
  it("6.1-T3: PM failure → onboard() rejects (integration test proves tx rollback)", async () => {
    const { tx } = makeOnboardTxWithPM({
      pmCreateError: new Error("PM DB failure"),
    });
    mockPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    const token = makeOnboardToken();
    await expect(onboard(token)).rejects.toThrow("PM DB failure");
  });

  // 6.2-T1: no assignments → PM helper not called, invite consumed via update
  it("6.2-T1: invite with no projectAssignments → no PM call, consumedAt update called", async () => {
    const { tx, updateFn } = makeOnboardTxWithPM({
      invite: { project_assignments: null },
      liveProjectIds: [],
    });
    mockPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    const token = makeOnboardToken();
    await onboard(token);

    expect(tx.projectMember.createMany).not.toHaveBeenCalled();
    // consumedAt update was called (invite consumed normally)
    expect(updateFn).toHaveBeenCalledOnce();
  });
});

// ── exchange() tests ──────────────────────────────────────────────────────────

describe("exchange()", () => {
  // Build an opaque refresh token and its hash (same way service does it)
  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");

  const mockRow = {
    id: "rt-row-1",
    userId: USER_ID,
    workspaceId: WORKSPACE_ID,
    tokenHash,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    revokedAt: null,
    lastUsedAt: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.refreshToken.findUnique.mockResolvedValue(mockRow);
    mockPrisma.refreshToken.update.mockResolvedValue(mockRow);
  });

  // D3: happy path
  it("happy path: returns accessToken and expiresIn=900", async () => {
    const result = await exchange(rawToken);

    expect(result).toHaveProperty("accessToken");
    expect(result.expiresIn).toBe(900);

    const decoded = jwt.decode(result.accessToken) as Record<string, unknown>;
    expect(decoded["sub"]).toBe(USER_ID);
    expect(decoded["workspace"]).toBe(WORKSPACE_ID);
    expect(decoded["scope"]).toBe("access");
  });

  // D3: token not in RefreshToken table → 401
  it("throws 401 INVALID_REFRESH_TOKEN when no DB row found", async () => {
    mockPrisma.refreshToken.findUnique.mockResolvedValue(null);

    await expect(exchange(rawToken)).rejects.toMatchObject({
      statusCode: 401,
      code: "INVALID_REFRESH_TOKEN",
    });
  });

  // D3: revoked → 401 TOKEN_REVOKED
  it("throws 401 TOKEN_REVOKED when revokedAt is set", async () => {
    mockPrisma.refreshToken.findUnique.mockResolvedValue({
      ...mockRow,
      revokedAt: new Date(),
    });

    await expect(exchange(rawToken)).rejects.toMatchObject({
      statusCode: 401,
      code: "TOKEN_REVOKED",
    });
  });

  // D3: expired → 401 TOKEN_EXPIRED
  it("throws 401 TOKEN_EXPIRED when expiresAt is in the past", async () => {
    mockPrisma.refreshToken.findUnique.mockResolvedValue({
      ...mockRow,
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(exchange(rawToken)).rejects.toMatchObject({
      statusCode: 401,
      code: "TOKEN_EXPIRED",
    });
  });

  // D3: updates lastUsedAt on success
  it("updates lastUsedAt on successful exchange", async () => {
    await exchange(rawToken);

    expect(mockPrisma.refreshToken.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rt-row-1" },
        data: expect.objectContaining({ lastUsedAt: expect.any(Date) }),
      }),
    );
  });
});

// ── signAccessToken() — T1.1 (KAN-19 PR1) ────────────────────────────────────

describe("signAccessToken() — allowedProjectIds claim (T1.1)", () => {
  const PROJECT_P = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const PROJECT_Q = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

  // T1.1-a: scoped — allowedProjectIds=[P] embeds claim in JWT
  it("embeds allowedProjectIds claim when ids=[P] (non-empty)", () => {
    const token = signAccessToken(USER_ID, WORKSPACE_ID, [PROJECT_P]);
    const decoded = jwt.decode(token) as Record<string, unknown>;

    expect(decoded["sub"]).toBe(USER_ID);
    expect(decoded["workspace"]).toBe(WORKSPACE_ID);
    expect(decoded["scope"]).toBe("access");
    expect(decoded["allowedProjectIds"]).toEqual([PROJECT_P]);
  });

  // T1.1-b: scoped — multiple ids embeds full array
  it("embeds full allowedProjectIds array when ids=[P,Q]", () => {
    const token = signAccessToken(USER_ID, WORKSPACE_ID, [PROJECT_P, PROJECT_Q]);
    const decoded = jwt.decode(token) as Record<string, unknown>;

    expect(decoded["allowedProjectIds"]).toEqual([PROJECT_P, PROJECT_Q]);
  });

  // T1.1-c (triangulation): unscoped — empty array → NO claim in JWT
  it("omits allowedProjectIds claim when ids=[] (unscoped)", () => {
    const token = signAccessToken(USER_ID, WORKSPACE_ID, []);
    const decoded = jwt.decode(token) as Record<string, unknown>;

    expect(decoded["sub"]).toBe(USER_ID);
    expect(decoded).not.toHaveProperty("allowedProjectIds");
  });

  // T1.1-d (triangulation): no ids arg → NO claim in JWT (backward compat)
  it("omits allowedProjectIds claim when ids param absent (backward compat)", () => {
    const token = signAccessToken(USER_ID, WORKSPACE_ID);
    const decoded = jwt.decode(token) as Record<string, unknown>;

    expect(decoded["sub"]).toBe(USER_ID);
    expect(decoded).not.toHaveProperty("allowedProjectIds");
  });
});

// ── issueRefreshFromLogin() tests ─────────────────────────────────────────────

describe("issueRefreshFromLogin()", () => {
  const mockMemberRow = {
    workspaceId: WORKSPACE_ID,
  };

  const mockRefreshTokenRow = {
    id: "rt-login-1",
    tokenHash: "hash",
    userId: USER_ID,
    workspaceId: WORKSPACE_ID,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.member.findFirst.mockResolvedValue(mockMemberRow);
    mockPrisma.refreshToken.create.mockResolvedValue(mockRefreshTokenRow);
  });

  // L5: happy path — member found → returns opaque token + expiresAt
  it("happy path: returns opaque refreshToken and expiresAt", async () => {
    const result = await issueRefreshFromLogin(USER_ID);

    expect(result).toHaveProperty("refreshToken");
    expect(typeof result.refreshToken).toBe("string");
    expect(result.refreshToken.length).toBeGreaterThan(10);
    // Must NOT be a JWT (opaque token)
    expect(result.refreshToken.split(".").length).not.toBe(3);
    expect(result).toHaveProperty("expiresAt");
    // expiresAt must be a valid ISO datetime string
    expect(() => new Date(result.expiresAt)).not.toThrow();
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  // L5: refreshToken.create called with correct args including source="LOGIN"
  it("calls refreshToken.create with userId, workspaceId, source=LOGIN", async () => {
    await issueRefreshFromLogin(USER_ID);

    expect(mockPrisma.refreshToken.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: USER_ID,
          workspaceId: WORKSPACE_ID,
          source: "LOGIN",
          expiresAt: expect.any(Date),
        }),
      }),
    );
  });

  // L5: uses member.findFirst (not findUnique) with correct filter
  it("queries member.findFirst by userId", async () => {
    await issueRefreshFromLogin(USER_ID);

    expect(mockPrisma.member.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER_ID },
      }),
    );
  });

  // L6: no workspace membership → 403 NO_WORKSPACE
  it("throws 403 NO_WORKSPACE when user has no membership", async () => {
    mockPrisma.member.findFirst.mockResolvedValue(null);

    await expect(issueRefreshFromLogin(USER_ID)).rejects.toMatchObject({
      statusCode: 403,
      code: "NO_WORKSPACE",
    });

    // Must not attempt to create a refresh token
    expect(mockPrisma.refreshToken.create).not.toHaveBeenCalled();
  });
});

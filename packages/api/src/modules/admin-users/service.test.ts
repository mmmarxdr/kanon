import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.mock("../../config/prisma.js", () => ({
  prisma: {
    member: {
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("../member/service.js", () => ({
  removeMember: vi.fn(),
  addMember: vi.fn(),
  changeMemberRole: vi.fn(),
}));

import { prisma } from "../../config/prisma.js";
import * as memberService from "../member/service.js";
import { bulkAction } from "./service.js";

describe("admin-users bulkAction error mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps non-AppError failures to INTERNAL_ERROR", async () => {
    const userId = randomUUID();
    const workspaceId = randomUUID();
    const memberId = randomUUID();

    vi.mocked(prisma.member.findUnique).mockResolvedValue({ id: memberId } as never);
    vi.mocked(memberService.removeMember).mockRejectedValue(new Error("boom"));

    const result = await bulkAction(
      {
        action: "remove_from_workspace",
        userIds: [userId],
        workspaceId,
      },
      randomUUID(),
    );

    expect(result.results).toEqual([
      { userId, ok: false, error: "INTERNAL_ERROR" },
    ]);
  });
});

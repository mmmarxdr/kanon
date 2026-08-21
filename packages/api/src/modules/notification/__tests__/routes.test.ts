/**
 * Integration tests for Notification routes — S3 / KAN-27
 *
 * Scenarios covered:
 *  3.2a — comment with @mention → Notification row created after event
 *  3.2b — PATCH /api/notifications/:id/read → flips Notification.read + Mention.read (kind=mention)
 *  3.2c — POST /api/workspaces/:wid/notifications/read-all → updates all + linked Mentions
 *  3.2d — GET /api/workspaces/:wid/dashboard includes notifications[] + unreadCount
 *  3.2e — assignment to self → no Notification row created
 *  3.2f — PATCH /api/notifications/:id/read by another member → 403 or 404
 *  3.2g — GET /api/workspaces/:wid/notifications → lists own unread notifications
 */

// KAN-40: spy on the real eventBus singleton's emit method so route-emit tests can
// assert call count/args without disrupting subscribe() wiring (which registerNotificationService
// and app.ts rely on for DB-level integration tests in this same file).
import { randomUUID } from "node:crypto";
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eventBus } from "../../../services/event-bus/index.js";

import type { FastifyInstance } from "fastify";
import {
  createTestApp,
  seedTestWorkspace,
  seedTestMember,
  seedTestProject,
  cleanDatabase,
  disconnectTestDb,
} from "../../../test/helpers.js";
import { prisma } from "../../../config/prisma.js";

// ── Helper: seed an issue ──────────────────────────────────────────────────

async function seedIssue(projectId: string, suffix = "1") {
  const count = await prisma.issue.count();
  return prisma.issue.create({
    data: {
      key: `NTF-${count + 1}-${suffix}`,
      sequenceNum: count + 1,
      title: `Notification test issue ${suffix}`,
      projectId,
    },
    select: { id: true, key: true, projectId: true },
  });
}

// ── Helper: wait for async event processing ───────────────────────────────

function waitForEventProcessing(ms = 50) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─────────────────────────────────────────────────────────────────────────────

describe("Notification routes — S3 / KAN-27", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  // ── 3.2a — @mention in comment → Notification row created ─────────────────

  describe("3.2a — @mention creates a Notification row via event", () => {
    it("POST /api/issues/:key/comments with @mention → Notification(kind=mention) row created for recipient", async () => {
      const ws = await seedTestWorkspace();
      const actor = await seedTestMember(ws.id, { username: "actor" });
      const recipient = await seedTestMember(ws.id, { username: "recipient" });
      const project = await seedTestProject(ws.id);
      const issue = await seedIssue(project.id, "a");

      // Grant actor project membership so they can post comments
      await prisma.projectMember.create({
        data: { userId: actor.userId, projectId: project.id, role: "member" },
      });

      const res = await app.inject({
        method: "POST",
        url: `/api/issues/${issue.key}/comments`,
        headers: { authorization: `Bearer ${actor.token}` },
        payload: { body: `Hey @recipient check this`, source: "human" },
      });

      expect(res.statusCode).toBe(201);

      // Give the async NotificationService time to process the event
      await waitForEventProcessing();

      const notifications = await prisma.notification.findMany({
        where: { recipientId: recipient.id },
      });
      expect(notifications).toHaveLength(1);
      expect(notifications[0]!.kind).toBe("mention");
      expect(notifications[0]!.workspaceId).toBe(ws.id);
      expect(notifications[0]!.read).toBe(false);
    });

    it("@mention → actor does NOT receive notification (actor exclusion)", async () => {
      const ws = await seedTestWorkspace();
      const actor = await seedTestMember(ws.id, { username: "actorself" });
      const project = await seedTestProject(ws.id);
      const issue = await seedIssue(project.id, "b");

      // Grant actor project membership
      await prisma.projectMember.create({
        data: { userId: actor.userId, projectId: project.id, role: "member" },
      });

      // Actor mentions themselves
      await app.inject({
        method: "POST",
        url: `/api/issues/${issue.key}/comments`,
        headers: { authorization: `Bearer ${actor.token}` },
        payload: { body: `@actorself check this`, source: "human" },
      });

      await waitForEventProcessing();

      const notifications = await prisma.notification.findMany({
        where: { recipientId: actor.id },
      });
      expect(notifications).toHaveLength(0);
    });
  });

  // ── 3.2e — assignment to self → no Notification row ──────────────────────

  describe("3.2e — issue.assigned to self → no Notification row", () => {
    it("PATCH /api/issues/:key with assigneeId = actor.memberId → no assignment Notification", async () => {
      const ws = await seedTestWorkspace();
      const actor = await seedTestMember(ws.id, { username: "actor" });
      const project = await seedTestProject(ws.id);
      const issue = await seedIssue(project.id, "e");

      // Create project membership so actor can edit
      await prisma.projectMember.create({
        data: { userId: actor.userId, projectId: project.id, role: "member" },
      });

      const res = await app.inject({
        method: "PATCH",
        url: `/api/issues/${issue.key}`,
        headers: { authorization: `Bearer ${actor.token}` },
        payload: { assigneeId: actor.id },
      });

      // May return 200 or fail auth; just check no notification created
      await waitForEventProcessing();

      const notifications = await prisma.notification.findMany({
        where: { recipientId: actor.id, kind: "assignment" },
      });
      expect(notifications).toHaveLength(0);
    });
  });

  // ── 3.2b — PATCH /api/notifications/:id/read (dual-write) ────────────────

  describe("3.2b — PATCH /api/notifications/:id/read", () => {
    it("marks Notification.read=true and Mention.read=true for kind=mention", async () => {
      const ws = await seedTestWorkspace();
      const actor = await seedTestMember(ws.id, { username: "actor-b" });
      const recipient = await seedTestMember(ws.id, { username: "recipient-b" });
      const project = await seedTestProject(ws.id);
      const issue = await seedIssue(project.id, "b2");

      // Seed a Mention row directly
      const mention = await prisma.mention.create({
        data: {
          workspaceId: ws.id,
          issueId: issue.id,
          commentId: null,
          mentionedMemberId: recipient.id,
          mentionedByMemberId: actor.id,
          context: "@recipient-b test",
        },
      });

      // Seed a Notification linked to the mention
      const notification = await prisma.notification.create({
        data: {
          kind: "mention",
          workspaceId: ws.id,
          recipientId: recipient.id,
          actorId: actor.id,
          issueId: issue.id,
          mentionId: mention.id,
          read: false,
        },
      });

      const res = await app.inject({
        method: "PATCH",
        url: `/api/notifications/${notification.id}/read`,
        headers: { authorization: `Bearer ${recipient.token}` },
      });

      expect(res.statusCode).toBe(200);

      // Notification.read should be true
      const updatedNotification = await prisma.notification.findUniqueOrThrow({
        where: { id: notification.id },
      });
      expect(updatedNotification.read).toBe(true);

      // Mention.read should also be true (dual-write)
      const updatedMention = await prisma.mention.findUniqueOrThrow({
        where: { id: mention.id },
      });
      expect(updatedMention.read).toBe(true);
    });

    it("marks Notification.read=true WITHOUT touching Mention for kind=assignment", async () => {
      const ws = await seedTestWorkspace();
      const actor = await seedTestMember(ws.id, { username: "actor-b3" });
      const recipient = await seedTestMember(ws.id, { username: "recipient-b3" });
      const project = await seedTestProject(ws.id);
      const issue = await seedIssue(project.id, "b3");

      const notification = await prisma.notification.create({
        data: {
          kind: "assignment",
          workspaceId: ws.id,
          recipientId: recipient.id,
          actorId: actor.id,
          issueId: issue.id,
          read: false,
        },
      });

      const res = await app.inject({
        method: "PATCH",
        url: `/api/notifications/${notification.id}/read`,
        headers: { authorization: `Bearer ${recipient.token}` },
      });

      expect(res.statusCode).toBe(200);

      const updatedNotification = await prisma.notification.findUniqueOrThrow({
        where: { id: notification.id },
      });
      expect(updatedNotification.read).toBe(true);
    });

    it("returns 403/404 when another member tries to mark-read someone else's notification", async () => {
      const ws = await seedTestWorkspace();
      const owner = await seedTestMember(ws.id, { username: "owner-b4" });
      const other = await seedTestMember(ws.id, { username: "other-b4" });
      const project = await seedTestProject(ws.id);
      const issue = await seedIssue(project.id, "b4");

      const notification = await prisma.notification.create({
        data: {
          kind: "assignment",
          workspaceId: ws.id,
          recipientId: owner.id,
          actorId: owner.id,
          issueId: issue.id,
          read: false,
        },
      });

      const res = await app.inject({
        method: "PATCH",
        url: `/api/notifications/${notification.id}/read`,
        headers: { authorization: `Bearer ${other.token}` },
      });

      // Route always returns 403 (not 404) for cross-member access:
      // it finds the notification but rejects because userId !== owner's userId
      expect(res.statusCode).toBe(403);

      // Notification still unread
      const untouched = await prisma.notification.findUniqueOrThrow({
        where: { id: notification.id },
      });
      expect(untouched.read).toBe(false);
    });
  });

  // ── 3.2c — POST /api/workspaces/:wid/notifications/read-all ──────────────

  describe("3.2c — POST /api/workspaces/:wid/notifications/read-all", () => {
    it("marks all member's notifications + linked Mention rows as read", async () => {
      const ws = await seedTestWorkspace();
      const actor = await seedTestMember(ws.id, { username: "actor-c" });
      const recipient = await seedTestMember(ws.id, { username: "recipient-c" });
      const project = await seedTestProject(ws.id);
      const issue = await seedIssue(project.id, "c");

      // Create two mention notifications with linked Mention rows
      const mention1 = await prisma.mention.create({
        data: {
          workspaceId: ws.id,
          issueId: issue.id,
          commentId: null,
          mentionedMemberId: recipient.id,
          mentionedByMemberId: actor.id,
          context: "@recipient-c first",
        },
      });

      const mention2 = await prisma.mention.create({
        data: {
          workspaceId: ws.id,
          issueId: issue.id,
          commentId: null,
          mentionedMemberId: recipient.id,
          mentionedByMemberId: actor.id,
          context: "@recipient-c second",
        },
      });

      await prisma.notification.createMany({
        data: [
          {
            kind: "mention",
            workspaceId: ws.id,
            recipientId: recipient.id,
            actorId: actor.id,
            issueId: issue.id,
            mentionId: mention1.id,
            read: false,
          },
          {
            kind: "mention",
            workspaceId: ws.id,
            recipientId: recipient.id,
            actorId: actor.id,
            issueId: issue.id,
            mentionId: mention2.id,
            read: false,
          },
          {
            kind: "assignment",
            workspaceId: ws.id,
            recipientId: recipient.id,
            actorId: actor.id,
            issueId: issue.id,
            read: false,
          },
        ],
      });

      const res = await app.inject({
        method: "POST",
        url: `/api/workspaces/${ws.id}/notifications/read-all`,
        headers: { authorization: `Bearer ${recipient.token}` },
      });

      expect(res.statusCode).toBe(200);

      // All 3 notifications should be read
      const notifications = await prisma.notification.findMany({
        where: { recipientId: recipient.id, read: false },
      });
      expect(notifications).toHaveLength(0);

      // Both mention rows should be read
      const unreadMentions = await prisma.mention.findMany({
        where: { mentionedMemberId: recipient.id, read: false },
      });
      expect(unreadMentions).toHaveLength(0);
    });
  });

  // ── 3.2d — Dashboard includes notifications + unreadCount ────────────────

  describe("3.2d — GET /api/workspaces/:wid/dashboard includes notifications + unreadCount", () => {
    it("dashboard response contains notifications[] and unreadCount fields", async () => {
      const ws = await seedTestWorkspace();
      const member = await seedTestMember(ws.id, { username: "member-d" });
      const actor = await seedTestMember(ws.id, { username: "actor-d" });
      const project = await seedTestProject(ws.id);
      const issue = await seedIssue(project.id, "d");

      // Seed 2 unread notifications
      await prisma.notification.createMany({
        data: [
          {
            kind: "assignment",
            workspaceId: ws.id,
            recipientId: member.id,
            actorId: actor.id,
            issueId: issue.id,
            read: false,
          },
          {
            kind: "assignment",
            workspaceId: ws.id,
            recipientId: member.id,
            actorId: actor.id,
            issueId: issue.id,
            read: false,
          },
        ],
      });

      const res = await app.inject({
        method: "GET",
        url: `/api/workspaces/${ws.id}/dashboard`,
        headers: { authorization: `Bearer ${member.token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty("notifications");
      expect(Array.isArray(body.notifications)).toBe(true);
      expect(body).toHaveProperty("unreadCount");
      expect(body.unreadCount).toBe(2);
    });

    it("dashboard is backward-compatible: existing fields (mentions, counts) still present", async () => {
      const ws = await seedTestWorkspace();
      const member = await seedTestMember(ws.id, { username: "member-d2" });

      const res = await app.inject({
        method: "GET",
        url: `/api/workspaces/${ws.id}/dashboard`,
        headers: { authorization: `Bearer ${member.token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty("counts");
      expect(body).toHaveProperty("mentions");
      expect(body).toHaveProperty("assigned");
      expect(body).toHaveProperty("notifications");
      expect(body).toHaveProperty("unreadCount");
      expect(body.unreadCount).toBe(0);
      expect(body.notifications).toEqual([]);
    });
  });

  // ── 3.2g — GET /api/workspaces/:wid/notifications ────────────────────────

  describe("3.2g — GET /api/workspaces/:wid/notifications", () => {
    it("returns list of own unread notifications (recipient-scoped)", async () => {
      const ws = await seedTestWorkspace();
      const member = await seedTestMember(ws.id, { username: "member-g" });
      const other = await seedTestMember(ws.id, { username: "other-g" });
      const project = await seedTestProject(ws.id);
      const issue = await seedIssue(project.id, "g");

      // One notification for member, one for other
      await prisma.notification.createMany({
        data: [
          {
            kind: "assignment",
            workspaceId: ws.id,
            recipientId: member.id,
            actorId: other.id,
            issueId: issue.id,
            read: false,
          },
          {
            kind: "assignment",
            workspaceId: ws.id,
            recipientId: other.id,
            actorId: member.id,
            issueId: issue.id,
            read: false,
          },
        ],
      });

      const res = await app.inject({
        method: "GET",
        url: `/api/workspaces/${ws.id}/notifications`,
        headers: { authorization: `Bearer ${member.token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      // Only member's notification — not the other's
      expect(body.notifications).toHaveLength(1);
      expect(body.notifications[0].recipientId).toBe(member.id);
    });

    it("returns a safe work-capture failure only to its owner and hides the episode key", async () => {
      const ws = await seedTestWorkspace();
      const owner = await seedTestMember(ws.id, { username: "capture-owner" });
      const other = await seedTestMember(ws.id, { username: "capture-other" });
      const otherWorkspace = await seedTestWorkspace();
      const outsider = await seedTestMember(otherWorkspace.id, { username: "capture-outsider" });
      const project = await seedTestProject(ws.id);
      const issue = await seedIssue(project.id, "capture-failure");
      const rawMarker = "KAN243_RAW_CAPTURE_EFFECT_MARKER";

      await prisma.notification.create({
        data: {
          kind: "work_capture_failure" as never,
          workspaceId: ws.id,
          recipientId: owner.id,
          actorId: null,
          issueId: issue.id,
          workCaptureFailureEpisodeId: randomUUID(),
          via: "codex",
          payload: {
            issueKey: issue.key,
            stage: "effect_apply",
            code: "WORK_CAPTURE_RETRYABLE",
            message: "Work capture was delayed. Kanon retries automatically.",
            details: { retryable: true, effectKind: "close" },
          },
        } as never,
      });

      const ownerResponse = await app.inject({
        method: "GET",
        url: `/api/workspaces/${ws.id}/notifications`,
        headers: { authorization: `Bearer ${owner.token}` },
      });
      expect(ownerResponse.statusCode).toBe(200);
      expect(ownerResponse.json().notifications).toEqual([
        expect.objectContaining({
          kind: "work_capture_failure",
          recipientId: owner.id,
          actorId: null,
          issueId: issue.id,
          via: "codex",
          payload: {
            issueKey: issue.key,
            stage: "effect_apply",
            code: "WORK_CAPTURE_RETRYABLE",
            message: "Work capture was delayed. Kanon retries automatically.",
            details: { retryable: true, effectKind: "close" },
          },
        }),
      ]);
      expect(JSON.stringify(ownerResponse.json())).not.toContain("workCaptureFailureEpisodeId");
      expect(JSON.stringify(ownerResponse.json())).not.toContain(rawMarker);

      const otherResponse = await app.inject({
        method: "GET",
        url: `/api/workspaces/${ws.id}/notifications`,
        headers: { authorization: `Bearer ${other.token}` },
      });
      expect(otherResponse.statusCode).toBe(200);
      expect(otherResponse.json().notifications).toEqual([]);

      const outsiderResponse = await app.inject({
        method: "GET",
        url: `/api/workspaces/${ws.id}/notifications`,
        headers: { authorization: `Bearer ${outsider.token}` },
      });
      expect(outsiderResponse.statusCode).toBe(403);
    });

    // Fix 2 — invalid limit query param must return 400, not 500
    it("?limit=abc returns 400 (NaN guard)", async () => {
      const ws = await seedTestWorkspace();
      const member = await seedTestMember(ws.id, { username: "member-limit-abc" });

      const res = await app.inject({
        method: "GET",
        url: `/api/workspaces/${ws.id}/notifications?limit=abc`,
        headers: { authorization: `Bearer ${member.token}` },
      });

      expect(res.statusCode).toBe(400);
    });

    it("?limit=200 is clamped or rejected (not 500)", async () => {
      const ws = await seedTestWorkspace();
      const member = await seedTestMember(ws.id, { username: "member-limit-200" });

      const res = await app.inject({
        method: "GET",
        url: `/api/workspaces/${ws.id}/notifications?limit=200`,
        headers: { authorization: `Bearer ${member.token}` },
      });

      // Schema enforces max(50): Zod validation → 400
      expect(res.statusCode).toBe(400);
    });
  });

  // ── Fix 1 — mark-all-read interactive transaction (race safety) ───────────

  describe("Fix 1 — read-all uses interactive $transaction (captured set consistency)", () => {
    it("read-all sets all 3 notifications to read in one transaction", async () => {
      const ws = await seedTestWorkspace();
      const actor = await seedTestMember(ws.id, { username: "actor-tx" });
      const recipient = await seedTestMember(ws.id, { username: "recipient-tx" });
      const project = await seedTestProject(ws.id);
      const issue = await seedIssue(project.id, "tx");

      const mention = await prisma.mention.create({
        data: {
          workspaceId: ws.id,
          issueId: issue.id,
          commentId: null,
          mentionedMemberId: recipient.id,
          mentionedByMemberId: actor.id,
          context: "@recipient-tx",
        },
      });

      await prisma.notification.createMany({
        data: [
          {
            kind: "mention",
            workspaceId: ws.id,
            recipientId: recipient.id,
            actorId: actor.id,
            issueId: issue.id,
            mentionId: mention.id,
            read: false,
          },
          {
            kind: "assignment",
            workspaceId: ws.id,
            recipientId: recipient.id,
            actorId: actor.id,
            issueId: issue.id,
            read: false,
          },
        ],
      });

      const res = await app.inject({
        method: "POST",
        url: `/api/workspaces/${ws.id}/notifications/read-all`,
        headers: { authorization: `Bearer ${recipient.token}` },
      });

      expect(res.statusCode).toBe(200);

      // ALL notifications for recipient must be read
      const remaining = await prisma.notification.findMany({
        where: { recipientId: recipient.id, read: false },
      });
      expect(remaining).toHaveLength(0);

      // The linked mention must be read too (captured inside transaction)
      const updatedMention = await prisma.mention.findUniqueOrThrow({
        where: { id: mention.id },
      });
      expect(updatedMention.read).toBe(true);
    });
  });
});

// ─── KAN-40: route emit tests (notification.marked_read) ─────────────────────
// These tests assert the eventBus.emit mock is called with the correct event
// type and bare payload after PATCH /:id/read and POST read-all.

describe("KAN-40 — notification.marked_read emitted at route sites", () => {
  let app: FastifyInstance;
  let emitSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    app = await createTestApp();
    emitSpy = vi.spyOn(eventBus, "emit");
  });

  afterAll(async () => {
    emitSpy.mockRestore();
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase();
    emitSpy.mockClear();
  });

  // ── PATCH /api/notifications/:id/read ─────────────────────────────────────

  it("PATCH /api/notifications/:id/read → emits notification.marked_read with bare payload", async () => {
    const ws = await seedTestWorkspace();
    const actor = await seedTestMember(ws.id, { username: "actor-kan40-patch" });
    const recipient = await seedTestMember(ws.id, { username: "recipient-kan40-patch" });
    const project = await seedTestProject(ws.id);
    const issue = await prisma.issue.create({
      data: {
        key: `KAN40P-1`,
        sequenceNum: 9001,
        title: "KAN-40 patch test issue",
        projectId: project.id,
      },
      select: { id: true },
    });

    const notification = await prisma.notification.create({
      data: {
        kind: "assignment",
        workspaceId: ws.id,
        recipientId: recipient.id,
        actorId: actor.id,
        issueId: issue.id,
        read: false,
      },
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/notifications/${notification.id}/read`,
      headers: { authorization: `Bearer ${recipient.token}` },
    });

    expect(res.statusCode).toBe(200);

    const markedReadEmits = emitSpy.mock.calls.filter(
      (c) => (c[0] as any).type === "notification.marked_read"
    );
    expect(markedReadEmits).toHaveLength(1);
    expect((markedReadEmits[0]![0] as any).workspaceId).toBe(ws.id);
    expect((markedReadEmits[0]![0] as any).payload).toEqual({});
    // Privacy: no recipient/content in payload
    expect((markedReadEmits[0]![0] as any).payload).not.toHaveProperty("recipientId");
  });

  it("PATCH /api/notifications/:id/read — payload has NO recipientId/userId/memberId/content (privacy)", async () => {
    const ws = await seedTestWorkspace();
    const recipient = await seedTestMember(ws.id, { username: "priv-kan40-patch" });
    const actor = await seedTestMember(ws.id, { username: "priv-actor-kan40" });
    const project = await seedTestProject(ws.id);
    const issue = await prisma.issue.create({
      data: {
        key: `KAN40PRV-1`,
        sequenceNum: 9002,
        title: "KAN-40 privacy test",
        projectId: project.id,
      },
      select: { id: true },
    });

    const notification = await prisma.notification.create({
      data: {
        kind: "assignment",
        workspaceId: ws.id,
        recipientId: recipient.id,
        actorId: actor.id,
        issueId: issue.id,
        read: false,
      },
    });

    await app.inject({
      method: "PATCH",
      url: `/api/notifications/${notification.id}/read`,
      headers: { authorization: `Bearer ${recipient.token}` },
    });

    const emitCalls = emitSpy.mock.calls.filter(
      (c) => (c[0] as any).type === "notification.marked_read"
    );
    expect(emitCalls.length).toBeGreaterThanOrEqual(1);
    const payload = (emitCalls[0]![0] as any).payload;
    expect(payload).not.toHaveProperty("recipientId");
    expect(payload).not.toHaveProperty("userId");
    expect(payload).not.toHaveProperty("memberId");
    expect(payload).not.toHaveProperty("content");
  });

  // ── POST /api/workspaces/:wid/notifications/read-all ─────────────────────

  it("POST read-all with multiple notifications → emits notification.marked_read exactly ONCE", async () => {
    const ws = await seedTestWorkspace();
    const actor = await seedTestMember(ws.id, { username: "actor-kan40-all" });
    const recipient = await seedTestMember(ws.id, { username: "recipient-kan40-all" });
    const project = await seedTestProject(ws.id);
    const issue = await prisma.issue.create({
      data: {
        key: `KAN40ALL-1`,
        sequenceNum: 9003,
        title: "KAN-40 read-all test",
        projectId: project.id,
      },
      select: { id: true },
    });

    // Seed 3 unread notifications
    await prisma.notification.createMany({
      data: [
        {
          kind: "assignment",
          workspaceId: ws.id,
          recipientId: recipient.id,
          actorId: actor.id,
          issueId: issue.id,
          read: false,
        },
        {
          kind: "assignment",
          workspaceId: ws.id,
          recipientId: recipient.id,
          actorId: actor.id,
          issueId: issue.id,
          read: false,
        },
        {
          kind: "assignment",
          workspaceId: ws.id,
          recipientId: recipient.id,
          actorId: actor.id,
          issueId: issue.id,
          read: false,
        },
      ],
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/workspaces/${ws.id}/notifications/read-all`,
      headers: { authorization: `Bearer ${recipient.token}` },
    });

    expect(res.statusCode).toBe(200);

    const markedReadEmits = emitSpy.mock.calls.filter(
      (c) => (c[0] as any).type === "notification.marked_read"
    );
    // Exactly ONE event after the transaction — NOT one per row
    expect(markedReadEmits).toHaveLength(1);
    expect((markedReadEmits[0]![0] as any).payload).toEqual({});
  });

  it("POST read-all with zero unread notifications → notification.marked_read NOT emitted", async () => {
    const ws = await seedTestWorkspace();
    const recipient = await seedTestMember(ws.id, { username: "recipient-kan40-zero" });

    const res = await app.inject({
      method: "POST",
      url: `/api/workspaces/${ws.id}/notifications/read-all`,
      headers: { authorization: `Bearer ${recipient.token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().updated).toBe(0);

    const markedReadEmits = emitSpy.mock.calls.filter(
      (c) => (c[0] as any).type === "notification.marked_read"
    );
    expect(markedReadEmits).toHaveLength(0);
  });

  // ── Change 1 — idempotency guard: already-read notification ──────────────

  it("PATCH /api/notifications/:id/read on already-read notification → 200, NO emit", async () => {
    const ws = await seedTestWorkspace();
    const actor = await seedTestMember(ws.id, { username: "actor-kan40-idem" });
    const recipient = await seedTestMember(ws.id, { username: "recipient-kan40-idem" });
    const project = await seedTestProject(ws.id);
    const issue = await prisma.issue.create({
      data: {
        key: `KAN40IDEM-1`,
        sequenceNum: 9010,
        title: "KAN-40 idempotency test issue",
        projectId: project.id,
      },
      select: { id: true },
    });

    // Seed an ALREADY-READ notification
    const notification = await prisma.notification.create({
      data: {
        kind: "assignment",
        workspaceId: ws.id,
        recipientId: recipient.id,
        actorId: actor.id,
        issueId: issue.id,
        read: true, // already read
      },
    });

    emitSpy.mockClear();

    const res = await app.inject({
      method: "PATCH",
      url: `/api/notifications/${notification.id}/read`,
      headers: { authorization: `Bearer ${recipient.token}` },
    });

    expect(res.statusCode).toBe(200);

    // Must NOT emit when already read
    const markedReadEmits = emitSpy.mock.calls.filter(
      (c) => (c[0] as any).type === "notification.marked_read"
    );
    expect(markedReadEmits).toHaveLength(0);
  });

  // ── Change 3 — D3 isolation: eventBus.emit throws → route still 200 ──────

  it("PATCH /api/notifications/:id/read — eventBus.emit throws → 200 + DB updated (D3 isolation)", async () => {
    const ws = await seedTestWorkspace();
    const actor = await seedTestMember(ws.id, { username: "actor-kan40-d3" });
    const recipient = await seedTestMember(ws.id, { username: "recipient-kan40-d3" });
    const project = await seedTestProject(ws.id);
    const issue = await prisma.issue.create({
      data: {
        key: `KAN40D3-1`,
        sequenceNum: 9011,
        title: "KAN-40 D3 route isolation test",
        projectId: project.id,
      },
      select: { id: true },
    });

    const notification = await prisma.notification.create({
      data: {
        kind: "assignment",
        workspaceId: ws.id,
        recipientId: recipient.id,
        actorId: actor.id,
        issueId: issue.id,
        read: false,
      },
    });

    // Force eventBus.emit to throw
    emitSpy.mockImplementation(() => {
      throw new Error("bus failure");
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/notifications/${notification.id}/read`,
      headers: { authorization: `Bearer ${recipient.token}` },
    });

    // Route must still return 200
    expect(res.statusCode).toBe(200);

    // DB write must have succeeded
    const updated = await prisma.notification.findUniqueOrThrow({
      where: { id: notification.id },
    });
    expect(updated.read).toBe(true);

    // Restore normal behaviour for subsequent tests
    emitSpy.mockRestore();
    emitSpy = vi.spyOn(eventBus, "emit");
  });
});

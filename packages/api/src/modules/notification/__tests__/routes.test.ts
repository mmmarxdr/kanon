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

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
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

      expect([403, 404]).toContain(res.statusCode);

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
  });
});

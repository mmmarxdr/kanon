/**
 * Integration tests for IssueSubscription routes — S4 / KAN-28
 *
 * Scenarios covered:
 *  4.1a — PUT /api/issues/:key/subscription is idempotent (double call → one row)
 *  4.1b — DELETE /api/issues/:key/subscription removes subscription
 *  4.1c — GET /api/issues/:key/subscription returns status
 *  4.1d — createIssue → creator IssueSubscription exists
 *  4.1e — comment by non-subscriber auto-subscribes commenter
 *  4.1f — subscriber B on issue: event → Notification(subscribed_activity) for B; actor A not notified
 *  4.1g — unsubscribe stops fan-out (subsequent event → no Notification for unsubscribed member)
 *
 * TDD: RED first — production code does not yet exist.
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
      key: `SUB-${count + 1}-${suffix}`,
      sequenceNum: count + 1,
      title: `Subscription test issue ${suffix}`,
      projectId,
    },
    select: { id: true, key: true, projectId: true },
  });
}

// ── Helper: wait for async event processing ─────────────────────────────────

function waitForEventProcessing(ms = 80) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─────────────────────────────────────────────────────────────────────────────

describe("IssueSubscription routes — S4 / KAN-28", () => {
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

  // ── 4.1a — PUT /api/issues/:key/subscription is idempotent ────────────────

  describe("4.1a — PUT /api/issues/:key/subscription is idempotent", () => {
    it("double call → only one IssueSubscription row (no duplicate, no error)", async () => {
      const ws = await seedTestWorkspace();
      const member = await seedTestMember(ws.id, { username: "member-sub-a" });
      const project = await seedTestProject(ws.id);
      await prisma.projectMember.create({
        data: { userId: member.userId, projectId: project.id, role: "member" },
      });
      const issue = await seedIssue(project.id, "a");

      // First subscribe
      const res1 = await app.inject({
        method: "PUT",
        url: `/api/issues/${issue.key}/subscription`,
        headers: { authorization: `Bearer ${member.token}` },
      });
      expect(res1.statusCode).toBe(200);
      expect(res1.json()).toMatchObject({ subscribed: true });

      // Second subscribe (idempotent — must not error)
      const res2 = await app.inject({
        method: "PUT",
        url: `/api/issues/${issue.key}/subscription`,
        headers: { authorization: `Bearer ${member.token}` },
      });
      expect(res2.statusCode).toBe(200);
      expect(res2.json()).toMatchObject({ subscribed: true });

      // Exactly one row
      const subs = await prisma.issueSubscription.findMany({
        where: { issueId: issue.id, memberId: member.id },
      });
      expect(subs).toHaveLength(1);
    });
  });

  // ── 4.1b — DELETE /api/issues/:key/subscription removes row ───────────────

  describe("4.1b — DELETE /api/issues/:key/subscription removes subscription", () => {
    it("DELETE after PUT → subscription row deleted, subsequent GET returns subscribed=false", async () => {
      const ws = await seedTestWorkspace();
      const member = await seedTestMember(ws.id, { username: "member-sub-b" });
      const project = await seedTestProject(ws.id);
      await prisma.projectMember.create({
        data: { userId: member.userId, projectId: project.id, role: "member" },
      });
      const issue = await seedIssue(project.id, "b");

      // Subscribe
      await app.inject({
        method: "PUT",
        url: `/api/issues/${issue.key}/subscription`,
        headers: { authorization: `Bearer ${member.token}` },
      });

      // Unsubscribe
      const res = await app.inject({
        method: "DELETE",
        url: `/api/issues/${issue.key}/subscription`,
        headers: { authorization: `Bearer ${member.token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ subscribed: false });

      // Row gone
      const subs = await prisma.issueSubscription.findMany({
        where: { issueId: issue.id, memberId: member.id },
      });
      expect(subs).toHaveLength(0);
    });
  });

  // ── 4.1c — GET /api/issues/:key/subscription returns status ───────────────

  describe("4.1c — GET /api/issues/:key/subscription returns subscription status", () => {
    it("returns { subscribed: false } when not subscribed", async () => {
      const ws = await seedTestWorkspace();
      const member = await seedTestMember(ws.id, { username: "member-sub-c1" });
      const project = await seedTestProject(ws.id);
      await prisma.projectMember.create({
        data: { userId: member.userId, projectId: project.id, role: "member" },
      });
      const issue = await seedIssue(project.id, "c1");

      const res = await app.inject({
        method: "GET",
        url: `/api/issues/${issue.key}/subscription`,
        headers: { authorization: `Bearer ${member.token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ subscribed: false });
    });

    it("returns { subscribed: true } when subscribed", async () => {
      const ws = await seedTestWorkspace();
      const member = await seedTestMember(ws.id, { username: "member-sub-c2" });
      const project = await seedTestProject(ws.id);
      await prisma.projectMember.create({
        data: { userId: member.userId, projectId: project.id, role: "member" },
      });
      const issue = await seedIssue(project.id, "c2");

      // Seed subscription directly
      await prisma.issueSubscription.create({
        data: { issueId: issue.id, memberId: member.id, origin: "manual" },
      });

      const res = await app.inject({
        method: "GET",
        url: `/api/issues/${issue.key}/subscription`,
        headers: { authorization: `Bearer ${member.token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ subscribed: true });
    });
  });

  // ── 4.1d — createIssue → creator auto-subscribed ──────────────────────────

  describe("4.1d — createIssue auto-subscribes creator", () => {
    it("POST /api/projects/:key/issues → creator IssueSubscription row exists after creation", async () => {
      const ws = await seedTestWorkspace();
      const creator = await seedTestMember(ws.id, { username: "creator-d" });
      const project = await seedTestProject(ws.id);
      await prisma.projectMember.create({
        data: { userId: creator.userId, projectId: project.id, role: "member" },
      });

      const res = await app.inject({
        method: "POST",
        url: `/api/projects/${project.key}/issues`,
        headers: { authorization: `Bearer ${creator.token}` },
        payload: { title: "Test issue for auto-subscribe" },
      });

      expect(res.statusCode).toBe(201);
      const created = res.json();

      // Wait a tick for best-effort auto-subscribe
      await waitForEventProcessing(20);

      const sub = await prisma.issueSubscription.findUnique({
        where: { issueId_memberId: { issueId: created.id, memberId: creator.id } },
      });
      expect(sub).not.toBeNull();
      expect(sub!.origin).toBe("creator");
    });
  });

  // ── 4.1e — comment auto-subscribes commenter ──────────────────────────────

  describe("4.1e — createComment auto-subscribes commenter", () => {
    it("POST /api/issues/:key/comments by non-subscriber → commenter IssueSubscription created", async () => {
      const ws = await seedTestWorkspace();
      const actor = await seedTestMember(ws.id, { username: "commenter-e" });
      const project = await seedTestProject(ws.id);
      await prisma.projectMember.create({
        data: { userId: actor.userId, projectId: project.id, role: "member" },
      });
      const issue = await seedIssue(project.id, "e");

      // Ensure no subscription before the comment
      const beforeSubs = await prisma.issueSubscription.findMany({
        where: { issueId: issue.id, memberId: actor.id },
      });
      expect(beforeSubs).toHaveLength(0);

      const res = await app.inject({
        method: "POST",
        url: `/api/issues/${issue.key}/comments`,
        headers: { authorization: `Bearer ${actor.token}` },
        payload: { body: "This is a comment from a non-subscriber", source: "human" },
      });
      expect(res.statusCode).toBe(201);

      await waitForEventProcessing(20);

      const sub = await prisma.issueSubscription.findUnique({
        where: { issueId_memberId: { issueId: issue.id, memberId: actor.id } },
      });
      expect(sub).not.toBeNull();
      expect(sub!.origin).toBe("commenter");
    });
  });

  // ── 4.1f — subscribed_activity fan-out ────────────────────────────────────

  describe("4.1f — subscribed_activity fan-out: subscriber notified, actor excluded", () => {
    it("subscriber B on issue: state transition → Notification(subscribed_activity) for B, NOT for actor A", async () => {
      const ws = await seedTestWorkspace();
      const actorA = await seedTestMember(ws.id, { username: "actor-f" });
      const subscriberB = await seedTestMember(ws.id, { username: "subscriber-f" });
      const project = await seedTestProject(ws.id);
      await prisma.projectMember.create({
        data: { userId: actorA.userId, projectId: project.id, role: "member" },
      });
      await prisma.projectMember.create({
        data: { userId: subscriberB.userId, projectId: project.id, role: "member" },
      });
      const issue = await seedIssue(project.id, "f");

      // Subscribe B to the issue (manual, via DB direct)
      await prisma.issueSubscription.create({
        data: { issueId: issue.id, memberId: subscriberB.id, origin: "manual" },
      });

      // A transitions the issue
      const res = await app.inject({
        method: "POST",
        url: `/api/issues/${issue.key}/transition`,
        headers: { authorization: `Bearer ${actorA.token}` },
        payload: { to_state: "in_progress" },
      });
      expect(res.statusCode).toBe(200);

      // Wait for async NotificationService to process the event
      await waitForEventProcessing(100);

      // B should have a subscribed_activity notification
      const notifB = await prisma.notification.findMany({
        where: { recipientId: subscriberB.id, kind: "subscribed_activity" },
      });
      expect(notifB).toHaveLength(1);

      // A (the actor) should NOT have a subscribed_activity notification for their own action
      const notifA = await prisma.notification.findMany({
        where: { recipientId: actorA.id, kind: "subscribed_activity" },
      });
      expect(notifA).toHaveLength(0);
    });

    it("comment.created event → subscribed_activity notification for subscriber", async () => {
      const ws = await seedTestWorkspace();
      const actorA = await seedTestMember(ws.id, { username: "actor-f2" });
      const subscriberB = await seedTestMember(ws.id, { username: "subscriber-f2" });
      const project = await seedTestProject(ws.id);
      await prisma.projectMember.create({
        data: { userId: actorA.userId, projectId: project.id, role: "member" },
      });
      const issue = await seedIssue(project.id, "f2");

      // Subscribe B directly
      await prisma.issueSubscription.create({
        data: { issueId: issue.id, memberId: subscriberB.id, origin: "manual" },
      });

      // A posts a comment (triggers comment.created event)
      const res = await app.inject({
        method: "POST",
        url: `/api/issues/${issue.key}/comments`,
        headers: { authorization: `Bearer ${actorA.token}` },
        payload: { body: "A comment triggering subscribed_activity", source: "human" },
      });
      expect(res.statusCode).toBe(201);

      await waitForEventProcessing(100);

      // B should get subscribed_activity notification
      const notifB = await prisma.notification.findMany({
        where: { recipientId: subscriberB.id, kind: "subscribed_activity" },
      });
      expect(notifB).toHaveLength(1);
    });
  });

  // ── 4.1g — unsubscribe stops fan-out ──────────────────────────────────────

  describe("4.1g — unsubscribe stops fan-out", () => {
    it("after DELETE /subscription, subsequent event does NOT produce Notification for that member", async () => {
      const ws = await seedTestWorkspace();
      const actorA = await seedTestMember(ws.id, { username: "actor-g" });
      const memberB = await seedTestMember(ws.id, { username: "member-g" });
      const project = await seedTestProject(ws.id);
      await prisma.projectMember.create({
        data: { userId: actorA.userId, projectId: project.id, role: "member" },
      });
      await prisma.projectMember.create({
        data: { userId: memberB.userId, projectId: project.id, role: "member" },
      });
      const issue = await seedIssue(project.id, "g");

      // Subscribe B
      await app.inject({
        method: "PUT",
        url: `/api/issues/${issue.key}/subscription`,
        headers: { authorization: `Bearer ${memberB.token}` },
      });

      // Unsubscribe B
      await app.inject({
        method: "DELETE",
        url: `/api/issues/${issue.key}/subscription`,
        headers: { authorization: `Bearer ${memberB.token}` },
      });

      // A transitions the issue
      await app.inject({
        method: "POST",
        url: `/api/issues/${issue.key}/transition`,
        headers: { authorization: `Bearer ${actorA.token}` },
        payload: { to_state: "in_progress" },
      });

      await waitForEventProcessing(100);

      // B should have NO subscribed_activity notification (unsubscribed)
      const notifB = await prisma.notification.findMany({
        where: { recipientId: memberB.id, kind: "subscribed_activity" },
      });
      expect(notifB).toHaveLength(0);
    });
  });
});

/**
 * Integration tests for S5 — KAN-29
 *
 * 5.3a — GET /api/workspaces/:wid/notification-preferences returns row or defaults
 * 5.3b — PUT /api/workspaces/:wid/notification-preferences upserts 3 booleans
 * 5.3c — closeCycle → provider spy called for opted-in members, not opted-out
 *
 * TDD: RED first — tests reference endpoints and behaviour not yet implemented.
 *
 * Isolation note (item 7): 5.3c is a separate top-level describe with its own
 * app lifecycle. This prevents the shared `app` from also subscribing to the
 * singleton EventBus during 5.3c, which would cause double-dispatch and make
 * sendSpy call-count assertions non-deterministic.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
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
import type { EmailProvider } from "../../../services/email/types.js";

// ─────────────────────────────────────────────────────────────────────────────
// 5.3a + 5.3b — GET/PUT preferences (shared app, no email provider spy)
// ─────────────────────────────────────────────────────────────────────────────

describe("Notification preferences — S5 / KAN-29", () => {
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

  // ── 5.3a — GET returns defaults when no row exists ─────────────────────────

  describe("5.3a — GET /api/workspaces/:wid/notification-preferences", () => {
    it("returns all-true defaults when no preference row exists", async () => {
      const ws = await seedTestWorkspace();
      const member = await seedTestMember(ws.id, { username: "pref-user" });

      const res = await app.inject({
        method: "GET",
        url: `/api/workspaces/${ws.id}/notification-preferences`,
        headers: { authorization: `Bearer ${member.token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toMatchObject({
        emailMention: true,
        emailAssignment: true,
        emailCycleClosed: true,
      });
    });

    it("returns stored values after PUT", async () => {
      const ws = await seedTestWorkspace();
      const member = await seedTestMember(ws.id, { username: "pref-user-2" });

      // Create a preference row first
      await prisma.notificationPreference.create({
        data: {
          memberId: member.id,
          emailMention: false,
          emailAssignment: true,
          emailCycleClosed: false,
        },
      });

      const res = await app.inject({
        method: "GET",
        url: `/api/workspaces/${ws.id}/notification-preferences`,
        headers: { authorization: `Bearer ${member.token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toMatchObject({
        emailMention: false,
        emailAssignment: true,
        emailCycleClosed: false,
      });
    });
  });

  // ── 5.3b — PUT upserts 3 booleans ────────────────────────────────────────

  describe("5.3b — PUT /api/workspaces/:wid/notification-preferences", () => {
    it("upserts preferences and returns updated values", async () => {
      const ws = await seedTestWorkspace();
      const member = await seedTestMember(ws.id, { username: "pref-put-user" });

      const res = await app.inject({
        method: "PUT",
        url: `/api/workspaces/${ws.id}/notification-preferences`,
        headers: {
          authorization: `Bearer ${member.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          emailMention: false,
          emailAssignment: true,
          emailCycleClosed: false,
        }),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toMatchObject({
        emailMention: false,
        emailAssignment: true,
        emailCycleClosed: false,
      });

      // Verify persisted
      const row = await prisma.notificationPreference.findUnique({
        where: { memberId: member.id },
      });
      expect(row).not.toBeNull();
      expect(row!.emailMention).toBe(false);
      expect(row!.emailCycleClosed).toBe(false);
    });

    it("second PUT call updates (upserts) existing row", async () => {
      const ws = await seedTestWorkspace();
      const member = await seedTestMember(ws.id, { username: "pref-upsert-user" });

      // First PUT
      await app.inject({
        method: "PUT",
        url: `/api/workspaces/${ws.id}/notification-preferences`,
        headers: {
          authorization: `Bearer ${member.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ emailMention: false, emailAssignment: false, emailCycleClosed: false }),
      });

      // Second PUT (update)
      const res = await app.inject({
        method: "PUT",
        url: `/api/workspaces/${ws.id}/notification-preferences`,
        headers: {
          authorization: `Bearer ${member.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ emailMention: true, emailAssignment: false, emailCycleClosed: true }),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.emailMention).toBe(true);
      expect(body.emailCycleClosed).toBe(true);

      // Ensure only ONE row in DB
      const count = await prisma.notificationPreference.count({
        where: { memberId: member.id },
      });
      expect(count).toBe(1);
    });

    it("rejects body with non-boolean values (400)", async () => {
      const ws = await seedTestWorkspace();
      const member = await seedTestMember(ws.id, { username: "pref-invalid-user" });

      const res = await app.inject({
        method: "PUT",
        url: `/api/workspaces/${ws.id}/notification-preferences`,
        headers: {
          authorization: `Bearer ${member.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          emailMention: "yes",  // wrong type
          emailAssignment: true,
          emailCycleClosed: false,
        }),
      });

      expect(res.statusCode).toBe(400);
    });

    it("rejects body with missing required fields (full-replace: all 3 booleans required) → 400", async () => {
      // PUT is a full-replace: omitting any of the 3 required booleans must return 400.
      // The bridge schema uses z.boolean() (no .optional()) so Zod rejects missing fields.
      const ws = await seedTestWorkspace();
      const member = await seedTestMember(ws.id, { username: "pref-missing-field-user" });

      const res = await app.inject({
        method: "PUT",
        url: `/api/workspaces/${ws.id}/notification-preferences`,
        headers: {
          authorization: `Bearer ${member.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          emailMention: false,
          // emailAssignment intentionally omitted — must be rejected
          emailCycleClosed: true,
        }),
      });

      expect(res.statusCode).toBe(400);
    });

    it("rejects body with unknown extra fields → 400 (full-replace must be strict)", async () => {
      // PUT is a full-replace contract: unknown fields must be rejected, not silently stripped.
      // The bridge schema must use .strict() so `admin:true` or any unknown key → 400.
      const ws = await seedTestWorkspace();
      const member = await seedTestMember(ws.id, { username: "pref-strict-user" });

      const res = await app.inject({
        method: "PUT",
        url: `/api/workspaces/${ws.id}/notification-preferences`,
        headers: {
          authorization: `Bearer ${member.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          emailMention: true,
          emailAssignment: true,
          emailCycleClosed: true,
          admin: true, // unknown extra field — must be rejected
        }),
      });

      expect(res.statusCode).toBe(400);
    });
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// 5.3c — closeCycle email dispatch (isolated: own app, no shared EventBus sub)
//
// This test is a TOP-LEVEL describe, NOT nested inside the shared preferences
// describe above. Nesting it would cause both `app` and `spyApp` to subscribe
// to the singleton EventBus simultaneously — the shared app's ConsoleProvider
// handler would also fire, making sendSpy call-count assertions non-deterministic.
// Running isolated here ensures only `spyApp`'s handler is subscribed.
// ─────────────────────────────────────────────────────────────────────────────

describe("5.3c — closeCycle sends emails to opted-in members only (isolated)", () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await disconnectTestDb();
  });

  it("closing a cycle calls provider.send for opted-in members and not for opted-out ones", async () => {
    // Inject a spy EmailProvider so we can assert the full wiring:
    // closeCycle → eventBus → handleCycleClosed → provider.send
    const sendSpy = vi.fn().mockResolvedValue(undefined);
    const spyProvider: EmailProvider = { send: sendSpy };
    // Only ONE app is created — no shared app subscribes to the singleton bus here.
    const spyApp = await createTestApp({ emailProvider: spyProvider });

    try {
      const ws = await seedTestWorkspace();
      const actor = await seedTestMember(ws.id, { username: "cycle-actor" });
      const memberOptIn = await seedTestMember(ws.id, { username: "opted-in" });
      const memberOptOut = await seedTestMember(ws.id, { username: "opted-out" });

      const project = await seedTestProject(ws.id);

      // Grant project membership to all three
      await prisma.projectMember.create({
        data: { userId: actor.userId, projectId: project.id, role: "owner" },
      });
      await prisma.projectMember.create({
        data: { userId: memberOptIn.userId, projectId: project.id, role: "member" },
      });
      await prisma.projectMember.create({
        data: { userId: memberOptOut.userId, projectId: project.id, role: "member" },
      });

      // memberOptOut opts out of cycle-closed emails
      await prisma.notificationPreference.create({
        data: {
          memberId: memberOptOut.id,
          emailMention: true,
          emailAssignment: true,
          emailCycleClosed: false,
        },
      });

      // Create a cycle
      const cycleRes = await spyApp.inject({
        method: "POST",
        url: `/api/projects/${project.key}/cycles`,
        headers: {
          authorization: `Bearer ${actor.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Sprint 1",
          startDate: new Date().toISOString(),
          endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      });

      expect(cycleRes.statusCode).toBe(201);
      const { id: cycleId } = cycleRes.json();

      // Close the cycle
      const closeRes = await spyApp.inject({
        method: "POST",
        url: `/api/cycles/${cycleId}/close`,
        headers: { authorization: `Bearer ${actor.token}` },
      });

      expect(closeRes.statusCode).toBe(200);

      // Wait for async email dispatch (2 opted-in members) using vi.waitFor
      // instead of a fixed sleep — avoids timing flakiness.
      await vi.waitFor(() => expect(sendSpy).toHaveBeenCalledTimes(2), { timeout: 3000 });

      // No in-app Notification rows for cycle.closed (D5: email-only)
      const notificationRows = await prisma.notification.findMany({
        where: { kind: "cycle_closed" },
      });
      expect(notificationRows).toHaveLength(0);

      // Actor + memberOptIn → 2 opted-in members → provider.send called twice
      const sentTos = sendSpy.mock.calls.map((c: any) => c[0].to as string);
      expect(sentTos).toContain(actor.email);
      expect(sentTos).toContain(memberOptIn.email);

      // memberOptOut opted out → provider.send NOT called with their email
      expect(sentTos).not.toContain(memberOptOut.email);
    } finally {
      await spyApp.close();
    }
  });
});

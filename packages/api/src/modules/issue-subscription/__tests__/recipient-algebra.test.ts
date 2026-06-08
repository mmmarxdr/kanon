/**
 * Unit tests for S4 subscriber recipient-set algebra — S4 / KAN-28
 *
 * Task 4.2: Verify the dedup logic that determines which subscribers
 * receive a subscribed_activity notification:
 *   result = subscriber_set - actor - already_notified_by_specific_kind
 *
 * Tests are pure (no DB, no HTTP) — they test the helper function exported
 * from the notification handlers module.
 */

import { describe, it, expect } from "vitest";
import { buildSubscribedActivityRecipients } from "../../issue-subscription/service.js";

describe("4.2 — subscriber recipient-set algebra", () => {
  it("returns all subscribers minus the actor", () => {
    const subscribers = ["member-a", "member-b", "member-c"];
    const actorId = "member-a";
    const alreadyNotified = new Set<string>();

    const result = buildSubscribedActivityRecipients(subscribers, actorId, alreadyNotified);
    expect(result).toEqual(["member-b", "member-c"]);
  });

  it("excludes actor even if actor is in the subscriber list", () => {
    const subscribers = ["actor-id", "other-id"];
    const actorId = "actor-id";
    const alreadyNotified = new Set<string>();

    const result = buildSubscribedActivityRecipients(subscribers, actorId, alreadyNotified);
    expect(result).toEqual(["other-id"]);
  });

  it("excludes members already notified by a specific kind (e.g., assignee gets assignment notification)", () => {
    // The assignee was already notified with kind=assignment, so they
    // should NOT receive a duplicate subscribed_activity notification
    const subscribers = ["subscriber-a", "assignee-id", "subscriber-b"];
    const actorId = "actor-id";
    const alreadyNotified = new Set(["assignee-id"]); // assignee already notified

    const result = buildSubscribedActivityRecipients(subscribers, actorId, alreadyNotified);
    expect(result).toEqual(["subscriber-a", "subscriber-b"]);
  });

  it("excludes both actor and already-notified members", () => {
    const subscribers = ["actor-id", "mentioned-id", "subscriber-a"];
    const actorId = "actor-id";
    const alreadyNotified = new Set(["mentioned-id"]);

    const result = buildSubscribedActivityRecipients(subscribers, actorId, alreadyNotified);
    expect(result).toEqual(["subscriber-a"]);
  });

  it("returns empty array when all subscribers are excluded", () => {
    const subscribers = ["actor-id", "already-notified-id"];
    const actorId = "actor-id";
    const alreadyNotified = new Set(["already-notified-id"]);

    const result = buildSubscribedActivityRecipients(subscribers, actorId, alreadyNotified);
    expect(result).toEqual([]);
  });

  it("returns all subscribers when none are excluded (actor not subscribed, no already-notified)", () => {
    const subscribers = ["sub-a", "sub-b"];
    const actorId = "non-subscriber-actor";
    const alreadyNotified = new Set<string>();

    const result = buildSubscribedActivityRecipients(subscribers, actorId, alreadyNotified);
    expect(result).toEqual(["sub-a", "sub-b"]);
  });
});

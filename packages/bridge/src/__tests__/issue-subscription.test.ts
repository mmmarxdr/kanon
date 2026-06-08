/**
 * Bridge schema tests — IssueSubscription schemas (S4 / KAN-28)
 *
 * Parse/serialize tests for subscriptionStatusSchema.
 */

import { describe, it, expect } from "vitest";
import { subscriptionStatusSchema } from "../issue-subscription.js";

describe("subscriptionStatusSchema", () => {
  it("parses { subscribed: true }", () => {
    const result = subscriptionStatusSchema.parse({ subscribed: true });
    expect(result.subscribed).toBe(true);
  });

  it("parses { subscribed: false }", () => {
    const result = subscriptionStatusSchema.parse({ subscribed: false });
    expect(result.subscribed).toBe(false);
  });

  it("rejects missing subscribed field", () => {
    expect(() => subscriptionStatusSchema.parse({})).toThrow();
  });

  it("rejects non-boolean subscribed value", () => {
    expect(() => subscriptionStatusSchema.parse({ subscribed: "yes" })).toThrow();
  });
});

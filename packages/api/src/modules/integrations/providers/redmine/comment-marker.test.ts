import { describe, expect, it } from "vitest";
import {
  hasReservedCommentMarker,
  parseCommentMarker,
} from "./comment-marker.js";

const uuid = "550e8400-e29b-41d4-a716-446655440000";
const marker = `<!-- kanon-comment:${uuid} -->`;

describe("Redmine comment markers", () => {
  it("accepts exactly one canonical final marker and strips its separator", () => {
    expect(parseCommentMarker(`Delivered body\n\n${marker}`)).toEqual({
      commentId: uuid,
      marker,
      body: "Delivered body",
    });
  });

  it("rejects uppercase, misplaced, malformed, and multiple markers", () => {
    expect(parseCommentMarker(`Delivered body\n\n<!-- kanon-comment:${uuid.toUpperCase()} -->`)).toBeNull();
    expect(parseCommentMarker(`${marker}\nDelivered body`)).toBeNull();
    expect(parseCommentMarker("Delivered body\n\n<!-- kanon-comment:not-a-uuid -->")).toBeNull();
    expect(parseCommentMarker(`${marker}\n\n${marker}`)).toBeNull();
  });

  it("flags any marker-shaped local body as reserved", () => {
    expect(hasReservedCommentMarker(`Copied ${marker} into a local comment`)).toBe(true);
    expect(hasReservedCommentMarker("A normal local comment")).toBe(false);
  });
});

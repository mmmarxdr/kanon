/**
 * KAN-111 — documentKindSchema, DocumentKind, issueFilterValueSchema, IssueFilters
 *
 * RED tests written first (strict TDD). These assert behaviours that do NOT
 * exist yet in issue.ts. They are expected to FAIL until the GREEN step adds
 * the new exports.
 *
 * Test seam (5) from design.md:
 *  - issueSchema parses WITH documentKinds (backward compat: field optional)
 *  - issueSchema parses WITHOUT documentKinds
 *  - documentKindSchema rejects unknown kind
 *  - issueFilterValueSchema parses / rejects correctly
 */

import { describe, it, expect } from "vitest";
import {
  issueSchema,
  documentKindSchema,
  issueFilterValueSchema,
} from "./issue.js";
import type { DocumentKind, IssueFilters } from "./issue.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_ISSUE = {
  id: "550e8400-e29b-41d4-a716-446655440001",
  key: "KAN-42",
  title: "Auth module refactor",
  description: null,
  type: "feature",
  priority: "high",
  state: "in_progress",
  labels: [],
  assigneeId: null,
  assignee: null,
  parentId: null,
  groupKey: null,
  projectId: "proj-uuid-1",
  createdAt: "2026-06-15T00:00:00.000Z",
  updatedAt: "2026-06-15T00:00:00.000Z",
  activeWorkers: [],
};

// ─── documentKindSchema ───────────────────────────────────────────────────────

describe("documentKindSchema", () => {
  it.each(["adr", "pdr", "rfc", "note"] as const)(
    "accepts valid kind '%s'",
    (kind) => {
      expect(() => documentKindSchema.parse(kind)).not.toThrow();
      const result: DocumentKind = documentKindSchema.parse(kind);
      expect(result).toBe(kind);
    },
  );

  it("rejects unknown kind 'design-record'", () => {
    expect(() => documentKindSchema.parse("design-record")).toThrow();
  });

  it("rejects unknown kind 'meeting'", () => {
    expect(() => documentKindSchema.parse("meeting")).toThrow();
  });

  it("rejects empty string", () => {
    expect(() => documentKindSchema.parse("")).toThrow();
  });
});

// ─── issueSchema — documentKinds field ───────────────────────────────────────

describe("issueSchema — documentKinds (KAN-111)", () => {
  it("parses issue WITHOUT documentKinds (backward compatibility)", () => {
    const result = issueSchema.parse(BASE_ISSUE);
    expect(result.key).toBe("KAN-42");
    // documentKinds is optional — must not throw when absent
    expect((result as Record<string, unknown>)["documentKinds"]).toBeUndefined();
  });

  it("parses issue WITH documentKinds: [] (no documents)", () => {
    const result = issueSchema.parse({ ...BASE_ISSUE, documentKinds: [] });
    expect(result.documentKinds).toEqual([]);
  });

  it("parses issue WITH documentKinds: ['adr', 'rfc'] (two distinct kinds)", () => {
    const result = issueSchema.parse({
      ...BASE_ISSUE,
      documentKinds: ["adr", "rfc"],
    });
    expect(result.documentKinds).toEqual(["adr", "rfc"]);
  });

  it("rejects issue with invalid documentKind in array", () => {
    expect(() =>
      issueSchema.parse({ ...BASE_ISSUE, documentKinds: ["adr", "meeting"] }),
    ).toThrow();
  });
});

// ─── issueFilterValueSchema / IssueFilters ────────────────────────────────────

describe("issueFilterValueSchema", () => {
  it("parses empty object (all filters absent)", () => {
    const filters: IssueFilters = issueFilterValueSchema.parse({});
    expect(filters).toEqual({});
  });

  it("parses full filter object", () => {
    const input = {
      state: "done",
      type: "bug",
      priority: "high",
      q: "auth",
      hasDocuments: true,
      documentKind: "adr",
    };
    const filters: IssueFilters = issueFilterValueSchema.parse(input);
    expect(filters.state).toBe("done");
    expect(filters.type).toBe("bug");
    expect(filters.priority).toBe("high");
    expect(filters.q).toBe("auth");
    expect(filters.hasDocuments).toBe(true);
    expect(filters.documentKind).toBe("adr");
  });

  it("parses partial filter with only q", () => {
    const filters = issueFilterValueSchema.parse({ q: "billing" });
    expect(filters.q).toBe("billing");
    expect(filters.state).toBeUndefined();
  });

  it("rejects invalid state value", () => {
    expect(() =>
      issueFilterValueSchema.parse({ state: "wont_fix" }),
    ).toThrow();
  });

  it("rejects invalid documentKind value", () => {
    expect(() =>
      issueFilterValueSchema.parse({ documentKind: "meeting" }),
    ).toThrow();
  });

  it("rejects invalid priority value", () => {
    expect(() =>
      issueFilterValueSchema.parse({ priority: "urgent" }),
    ).toThrow();
  });
});

import { describe, it, expect } from "vitest";
import { CreateDocumentBody, UpdateDocumentBody } from "./schema.js";

describe("Document Zod Schemas", () => {
  describe("CreateDocumentBody", () => {
    it("accepts valid document with all required fields", () => {
      const result = CreateDocumentBody.safeParse({
        kind: "adr",
        title: "Use Postgres for storage",
        body: "## Context\n\nWe need a reliable database.\n\n## Decision\n\nPostgres.",
      });
      expect(result.success).toBe(true);
    });

    it("accepts all valid kind values", () => {
      for (const kind of ["adr", "pdr", "rfc", "note"]) {
        const result = CreateDocumentBody.safeParse({
          kind,
          title: "Test doc",
          body: "Some body",
        });
        expect(result.success).toBe(true);
      }
    });

    it("defaults kind to 'note' when omitted", () => {
      const result = CreateDocumentBody.safeParse({
        title: "Test",
        body: "Some body",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.kind).toBe("note");
      }
    });

    it("rejects invalid kind value", () => {
      const result = CreateDocumentBody.safeParse({
        kind: "memo",
        title: "Test",
        body: "Body",
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty title", () => {
      const result = CreateDocumentBody.safeParse({
        kind: "adr",
        title: "",
        body: "Body",
      });
      expect(result.success).toBe(false);
    });

    it("rejects title longer than 200 chars", () => {
      const result = CreateDocumentBody.safeParse({
        kind: "adr",
        title: "x".repeat(201),
        body: "Body",
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty body", () => {
      const result = CreateDocumentBody.safeParse({
        kind: "adr",
        title: "Test",
        body: "",
      });
      expect(result.success).toBe(false);
    });

    it("rejects body longer than 50000 chars", () => {
      const result = CreateDocumentBody.safeParse({
        kind: "adr",
        title: "Test",
        body: "x".repeat(50001),
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing title", () => {
      const result = CreateDocumentBody.safeParse({
        kind: "adr",
        body: "Body",
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing body", () => {
      const result = CreateDocumentBody.safeParse({
        kind: "adr",
        title: "Title",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("UpdateDocumentBody", () => {
    it("accepts partial update with title only", () => {
      const result = UpdateDocumentBody.safeParse({ title: "New title" });
      expect(result.success).toBe(true);
    });

    it("accepts partial update with body only", () => {
      const result = UpdateDocumentBody.safeParse({ body: "New body" });
      expect(result.success).toBe(true);
    });

    it("accepts partial update with kind only", () => {
      const result = UpdateDocumentBody.safeParse({ kind: "rfc" });
      expect(result.success).toBe(true);
    });

    it("accepts full update", () => {
      const result = UpdateDocumentBody.safeParse({
        title: "Updated title",
        body: "Updated body",
        kind: "pdr",
      });
      expect(result.success).toBe(true);
    });

    it("rejects empty body {} — at least one field required", () => {
      const result = UpdateDocumentBody.safeParse({});
      expect(result.success).toBe(false);
    });

    it("accepts body with title only", () => {
      const result = UpdateDocumentBody.safeParse({ title: "Some title" });
      expect(result.success).toBe(true);
    });

    it("accepts body with body only", () => {
      const result = UpdateDocumentBody.safeParse({ body: "Some content" });
      expect(result.success).toBe(true);
    });

    it("accepts body with kind only", () => {
      const result = UpdateDocumentBody.safeParse({ kind: "adr" });
      expect(result.success).toBe(true);
    });
  });
});

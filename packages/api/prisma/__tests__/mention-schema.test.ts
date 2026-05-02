/**
 * Schema introspection tests — Mention model (inbox-redesign-cycle-c)
 *
 * Uses Prisma.dmmf.datamodel to assert model fields, relations, and unique
 * constraints. For non-unique indexes (not exposed in Prisma 6 DMMF), queries
 * pg_indexes directly via the Prisma raw client.
 *
 * TDD flow:
 *  RED  — fails before schema.prisma is updated (model absent)
 *  GREEN — passes after schema edit + `prisma generate` + migration applied
 *
 * Refs: REQ-MENTION-001, design §2.1
 */

import { describe, it, expect, afterAll } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";

const { datamodel } = Prisma.dmmf;

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function findModel(name: string) {
  return datamodel.models.find((m) => m.name === name);
}

function findField(modelName: string, fieldName: string) {
  const model = findModel(modelName);
  return model?.fields.find((f) => f.name === fieldName);
}

// ─── Mention model — existence ───────────────────────────────────────────────

describe("Mention model", () => {
  it("exists in the datamodel", () => {
    expect(findModel("Mention")).toBeDefined();
  });

  // ─── Required scalar fields ────────────────────────────────────────────────

  const scalarFields: Array<{
    name: string;
    type: string;
    required: boolean;
    hasDefault?: boolean;
  }> = [
    { name: "id",                  type: "String",   required: true  },
    { name: "workspaceId",         type: "String",   required: true  },
    { name: "issueId",             type: "String",   required: true  },
    { name: "commentId",           type: "String",   required: false },
    { name: "mentionedMemberId",   type: "String",   required: true  },
    { name: "mentionedByMemberId", type: "String",   required: true  },
    { name: "context",             type: "String",   required: true  },
    { name: "read",                type: "Boolean",  required: true,  hasDefault: true },
    { name: "createdAt",           type: "DateTime", required: true,  hasDefault: true },
  ];

  for (const { name, type, required, hasDefault } of scalarFields) {
    it(`has field "${name}" of type ${type} (required=${required})`, () => {
      const field = findField("Mention", name);
      expect(field, `field "${name}" is missing`).toBeDefined();
      expect(field?.type).toBe(type);
      expect(field?.isRequired).toBe(required);
    });

    if (hasDefault) {
      it(`field "${name}" has a default value`, () => {
        const field = findField("Mention", name);
        expect(field?.default).toBeDefined();
      });
    }
  }

  // ─── read defaults to false ────────────────────────────────────────────────

  it('field "read" defaults to false', () => {
    const field = findField("Mention", "read");
    expect(field?.default).toBe(false);
  });

  // ─── commentId is nullable ─────────────────────────────────────────────────

  it('field "commentId" is optional (nullable)', () => {
    const field = findField("Mention", "commentId");
    expect(field?.isRequired).toBe(false);
  });

  // ─── FK relation fields ────────────────────────────────────────────────────

  const relations: Array<{ fieldName: string; relationType: string; isList: boolean }> = [
    { fieldName: "workspace",         relationType: "Workspace", isList: false },
    { fieldName: "issue",             relationType: "Issue",     isList: false },
    { fieldName: "comment",           relationType: "Comment",   isList: false },
    { fieldName: "mentionedMember",   relationType: "Member",    isList: false },
    { fieldName: "mentionedByMember", relationType: "Member",    isList: false },
  ];

  for (const { fieldName, relationType, isList } of relations) {
    it(`has relation field "${fieldName}" of type ${relationType}`, () => {
      const field = findField("Mention", fieldName);
      expect(field, `relation field "${fieldName}" is missing`).toBeDefined();
      expect(field?.type).toBe(relationType);
      expect(field?.isList).toBe(isList);
    });
  }

  // ─── Back-relations on parent models ────────────────────────────────────────

  it("Workspace model has mentions back-relation", () => {
    const field = findField("Workspace", "mentions");
    expect(field, '"mentions" back-relation missing from Workspace').toBeDefined();
    expect(field?.type).toBe("Mention");
    expect(field?.isList).toBe(true);
  });

  it("Issue model has mentions back-relation", () => {
    const field = findField("Issue", "mentions");
    expect(field, '"mentions" back-relation missing from Issue').toBeDefined();
    expect(field?.type).toBe("Mention");
    expect(field?.isList).toBe(true);
  });

  it("Comment model has mentions back-relation", () => {
    const field = findField("Comment", "mentions");
    expect(field, '"mentions" back-relation missing from Comment').toBeDefined();
    expect(field?.type).toBe("Mention");
    expect(field?.isList).toBe(true);
  });

  it("Member model has mentionsReceived back-relation", () => {
    const field = findField("Member", "mentionsReceived");
    expect(field, '"mentionsReceived" back-relation missing from Member').toBeDefined();
    expect(field?.type).toBe("Mention");
    expect(field?.isList).toBe(true);
  });

  it("Member model has mentionsSent back-relation", () => {
    const field = findField("Member", "mentionsSent");
    expect(field, '"mentionsSent" back-relation missing from Member').toBeDefined();
    expect(field?.type).toBe("Mention");
    expect(field?.isList).toBe(true);
  });

  // ─── Unique constraint (via DMMF uniqueIndexes) ───────────────────────────

  it("has @@unique([commentId, mentionedMemberId]) compound constraint", () => {
    const model = findModel("Mention");
    expect(model, "Mention model missing").toBeDefined();
    const uniqueIdx = model!.uniqueIndexes.find(
      (u) =>
        u.fields.length === 2 &&
        u.fields.includes("commentId") &&
        u.fields.includes("mentionedMemberId"),
    );
    expect(
      uniqueIdx,
      "@@unique([commentId, mentionedMemberId]) constraint missing",
    ).toBeDefined();
  });

  // ─── Indexes via pg_indexes (non-unique @@index not in Prisma 6 DMMF) ─────
  //
  // Prisma 6 DMMF only exposes uniqueIndexes in the datamodel API.
  // Non-unique @@index() directives are applied to the DB but not reflected
  // in dmmf.datamodel.models[n].indexes (the property is undefined in v6).
  // We query pg_indexes directly to verify they were created by the migration.

  it("has idx_mention_dashboard_query index (workspaceId, mentionedMemberId, read, createdAt DESC)", async () => {
    const result = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'mentions' AND indexname = 'idx_mention_dashboard_query'
    `;
    expect(result.length, "idx_mention_dashboard_query index missing in DB").toBe(1);
  });

  it("has mentions_issue_id_idx index", async () => {
    const result = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'mentions' AND indexname = 'mentions_issue_id_idx'
    `;
    expect(result.length, "mentions_issue_id_idx index missing in DB").toBe(1);
  });

  it("has mentions_comment_id_idx index", async () => {
    const result = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'mentions' AND indexname = 'mentions_comment_id_idx'
    `;
    expect(result.length, "mentions_comment_id_idx index missing in DB").toBe(1);
  });
});

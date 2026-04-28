/**
 * Schema introspection tests — Batch A (team-onboarding-flow)
 *
 * These tests use Prisma.dmmf.datamodel to assert that the new enums,
 * columns, and model added in migration `team_onboarding` are present
 * in the generated Prisma client.
 *
 * TDD flow:
 *  RED  — fail before schema.prisma is updated (enums/model absent)
 *  GREEN — pass after schema edit + `prisma generate`
 */

import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";

const { datamodel } = Prisma.dmmf;

// ─── Helpers ────────────────────────────────────────────────────────────────

function findEnum(name: string) {
  return datamodel.enums.find((e) => e.name === name);
}

function findModel(name: string) {
  return datamodel.models.find((m) => m.name === name);
}

function findField(modelName: string, fieldName: string) {
  const model = findModel(modelName);
  return model?.fields.find((f) => f.name === fieldName);
}

// ─── InviteKind enum ─────────────────────────────────────────────────────────

describe("InviteKind enum", () => {
  it("exists in the datamodel", () => {
    expect(findEnum("InviteKind")).toBeDefined();
  });

  it("has MEMBER value", () => {
    const e = findEnum("InviteKind");
    expect(e?.values.map((v) => v.name)).toContain("MEMBER");
  });

  it("has ONBOARDING value", () => {
    const e = findEnum("InviteKind");
    expect(e?.values.map((v) => v.name)).toContain("ONBOARDING");
  });
});

// ─── RefreshSource enum ───────────────────────────────────────────────────────

describe("RefreshSource enum", () => {
  it("exists in the datamodel", () => {
    expect(findEnum("RefreshSource")).toBeDefined();
  });

  it("has ONBOARDING value", () => {
    const e = findEnum("RefreshSource");
    expect(e?.values.map((v) => v.name)).toContain("ONBOARDING");
  });

  it("has LOGIN value", () => {
    const e = findEnum("RefreshSource");
    expect(e?.values.map((v) => v.name)).toContain("LOGIN");
  });
});

// ─── WorkspaceInvite new columns ─────────────────────────────────────────────

describe("WorkspaceInvite model — new columns", () => {
  it("has kind field of type InviteKind", () => {
    const field = findField("WorkspaceInvite", "kind");
    expect(field).toBeDefined();
    expect(field?.type).toBe("InviteKind");
  });

  it("kind field has default MEMBER", () => {
    const field = findField("WorkspaceInvite", "kind");
    expect(field?.default).toBe("MEMBER");
  });

  it("has consumedAt field of type DateTime", () => {
    const field = findField("WorkspaceInvite", "consumedAt");
    expect(field).toBeDefined();
    expect(field?.type).toBe("DateTime");
  });

  it("consumedAt field is optional (nullable)", () => {
    const field = findField("WorkspaceInvite", "consumedAt");
    expect(field?.isRequired).toBe(false);
  });
});

// ─── RefreshToken model ───────────────────────────────────────────────────────

describe("RefreshToken model", () => {
  it("exists in the datamodel", () => {
    expect(findModel("RefreshToken")).toBeDefined();
  });

  const requiredFields: Array<{ name: string; type: string; required: boolean }> = [
    { name: "id",          type: "String",        required: true },
    { name: "userId",      type: "String",        required: true },
    { name: "workspaceId", type: "String",        required: true },
    { name: "tokenHash",   type: "String",        required: true },
    { name: "source",      type: "RefreshSource", required: true },
    { name: "createdAt",   type: "DateTime",      required: true },
    { name: "expiresAt",   type: "DateTime",      required: true },
    { name: "lastUsedAt",  type: "DateTime",      required: false },
    { name: "revokedAt",   type: "DateTime",      required: false },
    { name: "metadata",    type: "Json",          required: false },
  ];

  for (const { name, type, required } of requiredFields) {
    it(`has field ${name} of type ${type} (required=${required})`, () => {
      const field = findField("RefreshToken", name);
      expect(field, `field ${name} missing`).toBeDefined();
      expect(field?.type).toBe(type);
      expect(field?.isRequired).toBe(required);
    });
  }

  it("tokenHash field is @unique", () => {
    const field = findField("RefreshToken", "tokenHash");
    expect(field?.isUnique).toBe(true);
  });

  it("has User relation via userId", () => {
    const field = findField("RefreshToken", "user");
    expect(field).toBeDefined();
    expect(field?.type).toBe("User");
  });

  it("has Workspace relation via workspaceId", () => {
    const field = findField("RefreshToken", "workspace");
    expect(field).toBeDefined();
    expect(field?.type).toBe("Workspace");
  });
});

// ─── Back-relations ───────────────────────────────────────────────────────────

describe("Back-relations added to User and Workspace", () => {
  it("User model has refreshTokens relation", () => {
    const field = findField("User", "refreshTokens");
    expect(field).toBeDefined();
    expect(field?.type).toBe("RefreshToken");
    expect(field?.isList).toBe(true);
  });

  it("Workspace model has refreshTokens relation", () => {
    const field = findField("Workspace", "refreshTokens");
    expect(field).toBeDefined();
    expect(field?.type).toBe("RefreshToken");
    expect(field?.isList).toBe(true);
  });
});

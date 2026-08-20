import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
const migration = new URL("./migrations/20260820130000_issue_privacy_hold/migration.sql", import.meta.url);
describe("privacy hold schema foundation", () => {
  it("adds generation-based hold state without exposing quarantine through Prisma", async () => {
    const schema = await readFile(new URL("./schema.prisma", import.meta.url), "utf8");
    expect(schema).toMatch(/privacyHeldAt\s+DateTime\?\s+@map\("privacy_held_at"\)/);
    expect(schema).toMatch(/privacyHoldGeneration\s+Int\s+@default\(0\)\s+@map\("privacy_hold_generation"\)/);
    expect(schema).not.toMatch(/model\s+PrivacyQuarantine/);
  });
  it("records typed provenance separately from quarantine payloads", async () => {
    const schema = await readFile(new URL("./schema.prisma", import.meta.url), "utf8");
    expect(schema).toMatch(/enum IntegrationContentOrigin/);
    expect(schema).toMatch(/model IntegrationContentProvenance/);
    expect(schema).toMatch(/@@unique\(\[bindingId, entityType, entityId, field\]\)/);
  });
  it("isolates encrypted snapshots in a non-public SQL schema", async () => {
    const sql = await readFile(migration, "utf8");
    expect(sql).toContain('CREATE SCHEMA "privacy_quarantine"');
    expect(sql).toContain('CREATE TABLE "privacy_quarantine"."issue_content"');
    expect(sql).toContain('REVOKE ALL ON SCHEMA "privacy_quarantine" FROM PUBLIC');
    expect(sql).toContain('REVOKE ALL ON TABLE "privacy_quarantine"."issue_content" FROM PUBLIC');
  });
});

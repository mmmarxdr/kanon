import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const migration = () => fs.readFileSync(path.join(root, "prisma/migrations/20260820140000_privacy_authority/migration.sql"), "utf8");

describe("privacy authority migration", () => {
  it("provisions isolated roles, forced RLS, and a catalog gate", () => {
    const sql = migration();
    expect(sql).toContain('CREATE SCHEMA IF NOT EXISTS privacy_authority');
    expect(sql).toMatch(/FORCE ROW LEVEL SECURITY/);
    expect(sql).toContain("issue_visible");
    expect(sql).toContain("assert_catalog");
  });
  it("binds recovery capability and receipts to the complete server-derived context", () => {
    const sql = migration();
    expect(sql).toContain("recovery_receipts");
    expect(sql).toContain("mint_recovery_capability");
    expect(sql).toContain("credential_fingerprint");
    expect(sql).toContain("scope_fingerprint");
    expect(sql).toContain("clock_timestamp() - interval '60 seconds'");
  });
  it.each(["requirements.txt", "CMakeLists.txt", "README.sh", "guide.mdx"])("rejects non-entrypoint executable %s", (name) => {
    const source = fs.readFileSync(path.join(root, "scripts/one-shot-migrator.ts"), "utf8");
    expect(source).toContain("MIGRATOR_ENTRYPOINT");
    expect(source).not.toContain(name);
  });
});

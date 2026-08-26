import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveSafeE2eDatabaseUrl } from "../../e2e/e2e-environment";
const migration = new URL("./migrations/20260820130000_issue_privacy_hold/migration.sql", import.meta.url);
const containment = new URL("./migrations/20260821132000_privacy_atomic_containment/migration.sql", import.meta.url);
const writeFence = new URL("./migrations/20260826120000_privacy_write_dispatch_fencing/migration.sql", import.meta.url);
const e2eGlobalSetup = new URL("../../e2e/global-setup.ts", import.meta.url);
const apiDir = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.resolve(apiDir, "../../e2e/playwright.config.ts");
const tsxPath = path.resolve(apiDir, "../node_modules/.bin/tsx");

function evaluatePlaywrightConfig(env: NodeJS.ProcessEnv) {
  return spawnSync(
    tsxPath,
    [
      "--eval",
      `import config from ${JSON.stringify(configPath)}; console.log(JSON.stringify((config as { webServer: Array<{ env: Record<string, string>; reuseExistingServer: boolean }> }).webServer));`,
    ],
    {
      cwd: path.resolve(apiDir, "../.."),
      env: Object.fromEntries(
        Object.entries({ ...process.env, ...env }).filter(([, value]) => value !== undefined),
      ),
      encoding: "utf8",
    },
  );
}
describe("privacy hold schema foundation", () => {
  it("rejects a remote inherited database URL during Playwright config evaluation before webServer startup", () => {
    const result = evaluatePlaywrightConfig({
      DATABASE_URL: "postgresql://kanon:kanon@db.example.com:5432/kanon_e2e?schema=public",
      NODE_ENV: "test",
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stderr}${result.stdout}`).toMatch(/loopback PostgreSQL URL/i);
  });
  it("rejects percent-encoded database paths during Playwright config evaluation", () => {
    const result = evaluatePlaywrightConfig({
      DATABASE_URL: "postgresql://kanon:kanon@[::1]:65433/%6banon_e2e?schema=privacy",
      NODE_ENV: undefined,
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stderr}${result.stdout}`).toMatch(/kanon_e2e/i);
  });
  it("falls back to repository .env.e2e only when DATABASE_URL is absent", () => {
    const result = evaluatePlaywrightConfig({ DATABASE_URL: undefined, NODE_ENV: undefined });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)[0].env).toMatchObject({
      DATABASE_URL: "postgresql://kanon:kanon@localhost:5432/kanon_e2e?schema=public",
      NODE_ENV: "test",
    });
  });
  it("rejects explicit production mode and malformed or wrong-database URLs during config evaluation", () => {
    for (const env of [
      { DATABASE_URL: "postgresql://kanon:kanon@localhost:5432/kanon_e2e", NODE_ENV: "production" },
      { DATABASE_URL: "not-a-url", NODE_ENV: "test" },
      { DATABASE_URL: "postgresql://kanon:kanon@localhost:5432/kanon", NODE_ENV: "test" },
    ]) {
      const result = evaluatePlaywrightConfig(env);
      expect(result.status).not.toBe(0);
      expect(`${result.stderr}${result.stdout}`).toMatch(/E2E database setup requires/i);
    }
  });
  it("adds generation-based hold state without exposing quarantine through Prisma", async () => {
    const schema = await readFile(new URL("./schema.prisma", import.meta.url), "utf8");
    expect(schema).toMatch(/privacyHeldAt\s+DateTime\?\s+@map\("privacy_held_at"\)/);
    expect(schema).toMatch(/privacyHoldGeneration\s+Int\s+@default\(dbgenerated\(\)\)\s+@map\("privacy_hold_generation"\)/);
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
    expect(sql).toMatch(/ADD COLUMN "privacy_hold_generation" INTEGER NOT NULL DEFAULT 0;[\s\S]*CREATE SCHEMA "privacy_quarantine"/);
    expect(sql).toContain('CREATE TABLE "privacy_quarantine"."issue_content"');
    expect(sql).toContain('REVOKE ALL ON SCHEMA "privacy_quarantine" FROM PUBLIC');
    expect(sql).toContain('REVOKE ALL ON TABLE "privacy_quarantine"."issue_content" FROM PUBLIC');
  });
  it("limits atomic containment to the operator and writes the held marker last", async () => {
    const sql = await readFile(containment, "utf8");
    expect(sql).toMatch(/prepare_containment[\s\S]*commit_containment/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, kanon_runtime/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION[\s\S]*TO kanon_privacy_operator/);
    expect(sql).not.toMatch(/GRANT [^;]*(TABLE|SCHEMA privacy_quarantine)[^;]*kanon_privacy_operator/);
    expect(sql.indexOf("privacy_quarantine.issue_content")).toBeLessThan(sql.lastIndexOf("privacy_held_at"));
    for (const kind of ["external_refs", "integration_sync_work", "integration_content_provenance", "integration_conflict", "domain_event_outbox"])
      expect(sql).toContain(`'${kind}'`);
  });
  it("keeps synchronization privacy roots nullable in Prisma and server-managed in SQL", async () => {
    const [schema, sql] = await Promise.all([
      readFile(new URL("./schema.prisma", import.meta.url), "utf8"),
      readFile(writeFence, "utf8"),
    ]);
    expect(schema).toMatch(/privacyIssueId\s+String\?\s+@map\("privacy_issue_id"\)\s+@db\.Uuid/);
    expect(schema).toMatch(/privacyHoldGeneration\s+Int\?\s+@map\("privacy_hold_generation"\)/);
    expect(sql).toMatch(/BEFORE INSERT OR UPDATE OF privacy_issue_id, privacy_hold_generation/);
    expect(sql).toMatch(/ALTER TABLE public\.integration_sync_work FORCE ROW LEVEL SECURITY/);
    expect(sql).not.toMatch(/REFERENCES public\.issues\(id\)/);
  });
  it("resets every custom privacy schema before Prisma replays migrations", async () => {
    const setup = await readFile(e2eGlobalSetup, "utf8");
    const schemaReset = setup.indexOf('DROP SCHEMA IF EXISTS "privacy_authority" CASCADE;');
    const quarantineReset = setup.indexOf('DROP SCHEMA IF EXISTS "privacy_quarantine" CASCADE;');
    const prismaReset = setup.indexOf("npx prisma migrate reset --force --skip-generate");

    expect(schemaReset).toBeGreaterThanOrEqual(0);
    expect(quarantineReset).toBeGreaterThanOrEqual(0);
    expect(schemaReset).toBeLessThan(prismaReset);
    expect(quarantineReset).toBeLessThan(prismaReset);
  });
  it("uses CASCADE only to clear the complete custom privacy schema set", async () => {
    const setup = await readFile(e2eGlobalSetup, "utf8");
    const resetBlock = setup.slice(
      setup.indexOf('DROP SCHEMA IF EXISTS "privacy_authority" CASCADE;'),
      setup.indexOf("npx prisma migrate reset --force --skip-generate"),
    );

    expect(resetBlock).toContain('DROP SCHEMA IF EXISTS "privacy_authority" CASCADE;');
    expect(resetBlock).toContain('DROP SCHEMA IF EXISTS "privacy_quarantine" CASCADE;');
    expect(resetBlock).not.toContain('DROP SCHEMA IF EXISTS "public"');
  });
  it("rejects inherited remote and wrong-database URLs before destructive setup", () => {
    expect(() =>
      resolveSafeE2eDatabaseUrl({
        DATABASE_URL: "postgresql://kanon:kanon@db.example.com:5432/kanon_e2e?schema=public",
        NODE_ENV: "test",
      }),
    ).toThrow(/loopback PostgreSQL URL/i);
    expect(() =>
      resolveSafeE2eDatabaseUrl({
        DATABASE_URL: "postgresql://kanon:kanon@localhost:5432/kanon?schema=public",
        NODE_ENV: "test",
      }),
    ).toThrow(/kanon_e2e/i);
  });
  it("rejects every Prisma host override before destructive setup", () => {
    for (const databaseUrl of [
      "postgresql://kanon:kanon@localhost:5432/kanon_e2e?host=db.example.com",
      "postgresql://kanon:kanon@localhost:5432/kanon_e2e?%68ost=db.example.com",
      "postgresql://kanon:kanon@localhost:5432/kanon_e2e?schema=public&host=%2Fvar%2Frun%2Fpostgresql",
      "postgresql://kanon:kanon@localhost:5432/kanon_e2e?host=localhost&host=db.example.com",
      "postgresql://kanon:kanon@localhost:5432/kanon_e2e?HOST=db.example.com",
    ]) {
      expect(() => resolveSafeE2eDatabaseUrl({ DATABASE_URL: databaseUrl, NODE_ENV: "test" })).toThrow(
        /loopback PostgreSQL URL/i,
      );
    }
  });
  it("accepts local E2E URLs on dynamic ports with the canonical database pathname", () => {
    expect(
      resolveSafeE2eDatabaseUrl({
        DATABASE_URL: "postgresql://kanon:kanon@127.0.0.1:65432/kanon_e2e?schema=privacy",
        NODE_ENV: "test",
      }),
    ).toBe("postgresql://kanon:kanon@127.0.0.1:65432/kanon_e2e?schema=privacy");
    expect(
      resolveSafeE2eDatabaseUrl({
        DATABASE_URL: "postgresql://kanon:kanon@[::1]:65433/kanon_e2e?schema=privacy",
        NODE_ENV: "test",
      }),
    ).toBe("postgresql://kanon:kanon@[::1]:65433/kanon_e2e?schema=privacy");
  });
  it("rejects encoded and double-encoded variants of the E2E database pathname", () => {
    for (const databaseUrl of [
      "postgresql://kanon:kanon@localhost:5432/%6banon_e2e?schema=public",
      "postgresql://kanon:kanon@localhost:5432/%6Banon_e2e?schema=public",
      "postgresql://kanon:kanon@localhost:5432/%256banon_e2e?schema=public",
    ]) {
      expect(() => resolveSafeE2eDatabaseUrl({ DATABASE_URL: databaseUrl, NODE_ENV: "test" })).toThrow(/kanon_e2e/i);
    }
  });
  it("fails closed for malformed or missing URLs and non-test mode", () => {
    for (const env of [
      { NODE_ENV: "test" },
      { DATABASE_URL: "not-a-url", NODE_ENV: "test" },
      { DATABASE_URL: "postgresql://kanon:kanon@localhost:5432/kanon_e2e", NODE_ENV: "production" },
    ]) {
      expect(() => resolveSafeE2eDatabaseUrl(env)).toThrow(/E2E database setup requires/i);
    }
  });
  it("runs the URL guard before Prisma commands or client construction", async () => {
    const setup = await readFile(e2eGlobalSetup, "utf8");
    const guard = setup.indexOf("establishControlledE2eEnvironment()");

    expect(guard).toBeGreaterThanOrEqual(0);
    expect(guard).toBeLessThan(setup.indexOf("npx prisma db execute --stdin"));
    expect(guard).toBeLessThan(setup.indexOf("npx prisma migrate reset --force --skip-generate"));
    expect(guard).toBeLessThan(setup.indexOf("new PrismaClient()"));
  });
  it("does not reuse a healthy process in place of the validated E2E API and web servers", () => {
    const databaseUrl = "postgresql://kanon:kanon@127.0.0.1:65432/kanon_e2e?schema=public";
    const result = evaluatePlaywrightConfig({ DATABASE_URL: databaseUrl, NODE_ENV: "test" });

    expect(result.status).toBe(0);
    const servers = JSON.parse(result.stdout) as Array<{
      env: Record<string, string>;
      reuseExistingServer: boolean;
    }>;
    expect(servers).toHaveLength(2);
    expect(servers[0]).toMatchObject({
      reuseExistingServer: false,
      env: { DATABASE_URL: databaseUrl, NODE_ENV: "test" },
    });
    expect(servers[1]).toMatchObject({ reuseExistingServer: false });
  });
});

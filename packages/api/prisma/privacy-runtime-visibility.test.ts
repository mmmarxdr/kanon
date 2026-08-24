import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
const execFile = promisify(execFileCallback);
const migrationUrl = new URL(
  "./migrations/20260821131000_privacy_runtime_visibility/migration.sql",
  import.meta.url
);
const direct = [
  "issues:id",
  "activity_logs:issue_id",
  "comments:issue_id",
  "work_sessions:issue_id",
  "work_logs:issue_id",
  "mentions:issue_id",
  "issue_documents:issue_id",
  "notifications:issue_id",
  "issue_subscriptions:issue_id",
  "issue_schedules:issueId",
  "estimate_revisions:issue_id",
  "issue_forecasts:issueId",
  "time_entries:issue_id",
  "milestone_deliverables:issue_id",
  "work_capture_intents:issue_id",
  "work_transition_lifecycles:issue_id",
  "triage_proposals:target_issue_id",
];
const paired = [
  "issue_dependencies:source_id:target_id",
  "interruptions:incident_issue_id:interrupted_issue_id",
];
const typed = ["external_refs", "integration_sync_work", "integration_content_provenance"];
const opaque = [
  "triage_proposal_contents",
  "triage_proposal_lifecycle_events",
  "mcp_proposals",
  "cycle_scope_events",
  "admin_audit_logs",
  "integration_inbound_applications",
  "integration_conflicts",
  "work_capture_owner_leases",
  "domain_event_outbox",
];
const protectedTables = [
  ...direct.map((x) => x.split(":")[0]),
  ...paired.map((x) => x.split(":")[0]),
  ...typed,
  ...opaque,
];
let container = "";
afterEach(async () => {
  if (container) await execFile("docker", ["rm", "-f", container]).catch(() => undefined);
  container = "";
});
async function sql(args: string[]) {
  const user = args.shift()!;
  const password =
    user === "kanon_runtime" ? "runtime" : user === "stale_privacy_member" ? "stale" : "owner";
  return execFile("docker", [
    "exec",
    container,
    "psql",
    "-v",
    "ON_ERROR_STOP=1",
    "-At",
    `postgresql://${user}:${password}@127.0.0.1:5432/privacy`,
    "-c",
    args.join(" "),
  ]);
}
describe("runtime privacy visibility migration", () => {
  it("defines the complete, role-scoped RLS contract without checkpoint authority", async () => {
    const source = await readFile(migrationUrl, "utf8");
    expect(source).toMatch(/CREATE ROLE kanon_privacy_authority NOLOGIN BYPASSRLS/);
    expect(source).toMatch(/PRIMARY KEY \(store_kind, row_pk, issue_id, hold_generation\)/);
    expect(source).toMatch(
      /GRANT EXECUTE ON FUNCTION privacy_authority\.issue_visible\(uuid\), privacy_authority\.row_visible\(text, text\) TO kanon_runtime/
    );
    expect(source).not.toMatch(
      /FORCE ROW LEVEL SECURITY|TO PUBLIC|assert_catalog|recovery_|tombstone|containment/i
    );
    for (const table of protectedTables) expect(source).toContain(`'${table}'`);
  });
  describe.runIf(process.env.KAN246_RUN_DISPOSABLE_POSTGRES === "1")("PostgreSQL 16 proof", () => {
    it("hides held rows from runtime while preserving owner recovery visibility", async () => {
      container = `kan246_visibility_${process.pid}_${Date.now()}`;
      await execFile("docker", [
        "run",
        "--rm",
        "-d",
        "--name",
        container,
        "-e",
        "POSTGRES_PASSWORD=owner",
        "-e",
        "POSTGRES_DB=privacy",
        "-p",
        "127.0.0.1::5432",
        "postgres:16",
      ]);
      await execFile("docker", [
        "exec",
        container,
        "sh",
        "-ec",
        "until psql -U postgres -d privacy -c 'SELECT 1' >/dev/null 2>&1; do sleep .2; done",
      ]);
      const port = (await execFile("docker", ["port", container, "5432/tcp"])).stdout
        .trim()
        .match(/:(\d+)$/)?.[1];
      expect(port).toMatch(/^\d+$/);
      expect(port).not.toMatch(/^(5432|5433)$/);
      const bootstrap = [
        "CREATE ROLE kanon_runtime LOGIN PASSWORD 'runtime' NOBYPASSRLS;",
        "CREATE ROLE kanon_privacy_authority NOLOGIN BYPASSRLS;",
        "CREATE ROLE stale_privacy_member LOGIN PASSWORD 'stale' NOBYPASSRLS;",
        "GRANT kanon_privacy_authority TO stale_privacy_member;",
        "CREATE TABLE issues(id uuid primary key, privacy_held_at timestamptz, privacy_hold_generation integer not null default 0);",
      ];
      for (const item of direct.slice(1)) {
        const [table, column] = item.split(":");
        bootstrap.push(
          `CREATE TABLE ${table}(id uuid primary key, ${column === "issueId" ? '"issueId"' : column} uuid);`
        );
      }
      for (const item of paired) {
        const [table, a, b] = item.split(":");
        bootstrap.push(`CREATE TABLE ${table}(id uuid primary key, ${a} uuid, ${b} uuid);`);
      }
      for (const table of typed)
        bootstrap.push(
          `CREATE TABLE ${table}(id uuid primary key, entity_type text not null, entity_id uuid not null);`
        );
      for (const table of opaque) bootstrap.push(`CREATE TABLE ${table}(id uuid primary key);`);
      bootstrap.push(
        "CREATE TABLE members(id uuid primary key); ALTER TABLE comments ADD COLUMN author_id uuid REFERENCES members(id) ON DELETE CASCADE; ALTER TABLE integration_sync_work ADD COLUMN payload text NOT NULL DEFAULT ''; ALTER TABLE domain_event_outbox ADD COLUMN payload jsonb NOT NULL DEFAULT '{}'::jsonb; GRANT USAGE ON SCHEMA public TO kanon_runtime; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO kanon_runtime;"
      );
      await sql(["postgres", bootstrap.join(" ")]);
      await execFile("docker", [
        "cp",
        new URL(migrationUrl).pathname,
        `${container}:/tmp/migration.sql`,
      ]);
      await execFile("docker", [
        "exec",
        container,
        "psql",
        "-v",
        "ON_ERROR_STOP=1",
        "postgresql://postgres:owner@127.0.0.1:5432/privacy",
        "-f",
        "/tmp/migration.sql",
      ]);
      const normal = "11111111-1111-1111-1111-111111111111";
      const held = "22222222-2222-2222-2222-222222222222";
      const heldAgain = "33333333-3333-3333-3333-333333333333";
      const row = "44444444-4444-4444-4444-444444444444";
      const visible = "55555555-5555-5555-5555-555555555555";
      const heldMember = "66666666-6666-6666-6666-666666666666";
      const visibleMember = "77777777-7777-7777-7777-777777777777";
      const fixtures = `INSERT INTO issues VALUES ('${normal}',NULL,0),('${held}',now(),1),('${heldAgain}',now(),2); INSERT INTO members VALUES ('${heldMember}'),('${visibleMember}'); INSERT INTO comments VALUES ('${row}','${held}','${heldMember}'),('${visible}','${normal}','${visibleMember}'); INSERT INTO external_refs VALUES ('${row}','issue','${held}'),('${visible}','project','${normal}'); INSERT INTO integration_sync_work(id,entity_type,entity_id,payload) VALUES ('${row}','comment','${held}','raw held comment body'),('${visible}','comment','${normal}','normal comment body'); INSERT INTO domain_event_outbox(id,payload) VALUES ('${row}','{"issueId":"${held}","durationS":120}'),('${visible}','{"issueId":"${normal}","durationS":60}'); INSERT INTO mcp_proposals VALUES ('${row}'),('${visible}'); INSERT INTO privacy_authority.held_row_associations VALUES ('mcp_proposal','${row}','${held}',1),('mcp_proposal','${row}','${heldAgain}',2),('integration_sync_work','${row}','${held}',1),('domain_event_outbox','${row}','${held}',1);`;
      await sql(["postgres", fixtures]);
      expect(
        (await sql(["kanon_runtime", "SELECT id FROM issues ORDER BY id"])).stdout.trim()
      ).toBe(normal);
      expect(
        (
          await sql([
            "kanon_runtime",
            "SELECT id FROM comments; SELECT id FROM external_refs; SELECT id FROM integration_sync_work; SELECT id FROM domain_event_outbox; SELECT id FROM mcp_proposals;",
          ])
        ).stdout.trim()
      ).toBe([visible, visible, visible, visible, visible].join("\n"));
      await expect(
        sql(["kanon_runtime", `DELETE FROM members WHERE id='${heldMember}'`])
      ).rejects.toThrow(/hidden privacy row/i);
      expect(
        (await sql(["postgres", `SELECT count(*) FROM comments WHERE id='${row}'`])).stdout.trim()
      ).toBe("1");
      await sql(["kanon_runtime", `DELETE FROM members WHERE id='${visibleMember}'`]);
      expect(
        (
          await sql(["postgres", `SELECT count(*) FROM comments WHERE id='${visible}'`])
        ).stdout.trim()
      ).toBe("0");
      await sql(["postgres", `DELETE FROM members WHERE id='${heldMember}'`]);
      expect(
        (await sql(["postgres", `SELECT count(*) FROM comments WHERE id='${row}'`])).stdout.trim()
      ).toBe("0");
      await expect(
        sql(["kanon_runtime", "SELECT * FROM privacy_authority.held_row_associations"])
      ).rejects.toThrow(/permission denied/i);
      expect((await sql(["postgres", "SELECT count(*) FROM issues"])).stdout.trim()).toBe("3");
      await sql([
        "postgres",
        `DELETE FROM privacy_authority.held_row_associations WHERE issue_id='${held}';`,
      ]);
      expect((await sql(["kanon_runtime", "SELECT id FROM mcp_proposals"])).stdout.trim()).toBe(
        visible
      );
      const catalog = await sql([
        "postgres",
        "SELECT has_function_privilege('kanon_runtime','privacy_authority.issue_visible(uuid)','EXECUTE'), has_function_privilege('kanon_runtime','privacy_authority.row_visible(text,text)','EXECUTE'); SELECT count(*) FROM pg_policies WHERE schemaname='public' AND roles @> ARRAY['kanon_runtime']::name[] AND cmd='ALL'; SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relrowsecurity AND NOT c.relforcerowsecurity; SELECT relrowsecurity FROM pg_class WHERE oid='public.domain_event_outbox'::regclass; SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND t.tgname='privacy_runtime_preserve_hidden' AND NOT t.tgisinternal;",
      ]);
      expect(catalog.stdout.trim().split("\n")).toEqual([
        "t|t",
        String(protectedTables.length),
        String(protectedTables.length),
        "t",
        String(protectedTables.length),
      ]);
      await expect(
        sql([
          "stale_privacy_member",
          "SET ROLE kanon_privacy_authority; SELECT count(*) FROM issues",
        ])
      ).rejects.toThrow(/permission denied to set role/i);
      await expect(
        sql(["kanon_runtime", `UPDATE issues SET privacy_held_at=now() WHERE id='${normal}'`])
      ).rejects.toThrow(/row-level security policy/i);
      await expect(
        sql([
          "kanon_runtime",
          "INSERT INTO issues VALUES ('66666666-6666-6666-6666-666666666666',now(),1)",
        ])
      ).rejects.toThrow(/row-level security policy/i);
    }, 60_000);
  });
});

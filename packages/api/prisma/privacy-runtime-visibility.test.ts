import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
const execFile = promisify(execFileCallback);
const migrationUrl = new URL(
  "./migrations/20260821131000_privacy_runtime_visibility/migration.sql",
  import.meta.url
);
const containmentUrl = new URL(
  "./migrations/20260821132000_privacy_atomic_containment/migration.sql",
  import.meta.url
);
const dispositionContainmentUrl = new URL(
  "./migrations/20260826110000_privacy_reconciliation_disposition_containment/migration.sql",
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
    user === "kanon_runtime"
      ? "runtime"
      : user === "kanon_privacy_operator"
        ? "operator"
        : user === "stale_privacy_member"
          ? "stale"
          : "owner";
  return execFile("docker", [
    "exec",
    container,
    "psql",
    "-v",
    "ON_ERROR_STOP=1",
    "-At",
    `postgresql://${user}:${password}@localhost:5432/privacy`,
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
        "CREATE ROLE kanon_privacy_operator LOGIN PASSWORD 'operator' NOBYPASSRLS;",
        "CREATE ROLE kanon_privacy_authority NOLOGIN BYPASSRLS;",
        "CREATE ROLE stale_privacy_member LOGIN PASSWORD 'stale' NOBYPASSRLS;",
        "GRANT kanon_privacy_authority TO stale_privacy_member;",
        "CREATE TABLE issues(id uuid primary key, privacy_held_at timestamptz, privacy_hold_generation integer not null default 0, key text not null default 'fixture', title text not null default 'fixture', description text, project_id uuid not null default '00000000-0000-0000-0000-000000000000');",
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
        "CREATE TABLE integration_project_bindings(id uuid primary key, project_id uuid not null, lifecycle text not null, released_at timestamptz); CREATE TABLE integration_reconciliation_dispositions(id uuid primary key, preview_identity uuid not null, remote_issue_id text not null, remote_source_version text not null, state text not null default 'pending', decision_kind text, decided_at timestamptz, decided_by_id uuid, accepted_ref_id uuid, binding_id uuid not null, created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null); CREATE TABLE projects(id uuid primary key, workspace_id uuid not null); CREATE TABLE cycles(id uuid primary key, project_id uuid not null); CREATE TABLE members(id uuid primary key); ALTER TABLE comments ADD COLUMN author_id uuid REFERENCES members(id) ON DELETE CASCADE, ADD COLUMN body text; ALTER TABLE time_entries ADD COLUMN hours numeric; ALTER TABLE external_refs ADD COLUMN binding_id uuid, ADD COLUMN external_id text, ADD COLUMN metadata jsonb; ALTER TABLE integration_sync_work ADD COLUMN binding_id uuid, ADD COLUMN ref_id uuid, ADD COLUMN payload jsonb NOT NULL DEFAULT '{}'::jsonb; ALTER TABLE integration_content_provenance ADD COLUMN binding_id uuid, ADD COLUMN field text, ADD COLUMN origin text, ADD COLUMN content_hash text; ALTER TABLE triage_proposals ADD COLUMN list_summary jsonb DEFAULT '{}'::jsonb; ALTER TABLE triage_proposal_contents ADD COLUMN proposal_id uuid, ADD COLUMN payload jsonb DEFAULT '{}'::jsonb; ALTER TABLE triage_proposal_lifecycle_events ADD COLUMN proposal_id uuid, ADD COLUMN reason text, ADD COLUMN details jsonb; ALTER TABLE mcp_proposals ADD COLUMN target_ref text, ADD COLUMN workspace_id uuid, ADD COLUMN project_id uuid; ALTER TABLE cycle_scope_events ADD COLUMN issue_key text, ADD COLUMN reason text, ADD COLUMN cycle_id uuid; ALTER TABLE admin_audit_logs ADD COLUMN entity_type text, ADD COLUMN entity_id text, ADD COLUMN payload jsonb DEFAULT '{}'::jsonb, ADD COLUMN reason text; ALTER TABLE integration_inbound_applications ADD COLUMN binding_id uuid, ADD COLUMN ref_id uuid, ADD COLUMN work_id uuid, ADD COLUMN remote_entity_type text, ADD COLUMN remote_id text, ADD COLUMN remote_parent_type text, ADD COLUMN remote_parent_id text, ADD COLUMN outcome jsonb; ALTER TABLE integration_conflicts ADD COLUMN binding_id uuid, ADD COLUMN ref_id uuid, ADD COLUMN work_id uuid, ADD COLUMN application_id uuid, ADD COLUMN local_evidence jsonb DEFAULT '{}'::jsonb, ADD COLUMN remote_evidence jsonb DEFAULT '{}'::jsonb; ALTER TABLE work_capture_owner_leases ADD COLUMN intent_id uuid; ALTER TABLE domain_event_outbox ADD COLUMN payload jsonb NOT NULL DEFAULT '{}'::jsonb, ADD COLUMN workspace_id uuid; ALTER TABLE notifications ADD COLUMN payload jsonb; CREATE SCHEMA privacy_quarantine; CREATE TABLE privacy_quarantine.issue_content(issue_id uuid, binding_id uuid, generation integer, snapshot_schema integer, envelope text, PRIMARY KEY(issue_id,binding_id,generation)); GRANT USAGE ON SCHEMA public TO kanon_runtime; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO kanon_runtime;"
      );
      await sql(["postgres", bootstrap.join(" ")]);
      for (const [url, name] of [
        [migrationUrl, "visibility"],
        [containmentUrl, "containment"],
      ] as const) {
        await execFile("docker", ["cp", new URL(url).pathname, `${container}:/tmp/${name}.sql`]);
        await execFile("docker", [
          "exec",
          container,
          "psql",
          "-v",
          "ON_ERROR_STOP=1",
          "postgresql://postgres:owner@localhost:5432/privacy",
          "-f",
          `/tmp/${name}.sql`,
        ]);
      }
      await sql([
        "postgres",
        "INSERT INTO projects VALUES ('40404040-4040-4040-4040-404040404040','41414141-4141-4141-4141-414141414141'); INSERT INTO issues(id,key,title,privacy_held_at,privacy_hold_generation,project_id) VALUES ('42424242-4242-4242-4242-424242424242','KAN-OLD','held',clock_timestamp(),1,'40404040-4040-4040-4040-404040404040'); INSERT INTO integration_project_bindings VALUES ('43434343-4343-4343-4343-434343434343','40404040-4040-4040-4040-404040404040','active',NULL); INSERT INTO external_refs(id,entity_type,entity_id,binding_id,external_id) VALUES ('44444444-4444-4444-4444-444444444445','issue','42424242-4242-4242-4242-424242424242','43434343-4343-4343-4343-434343434343','old-remote'); INSERT INTO integration_reconciliation_dispositions(id,preview_identity,remote_issue_id,remote_source_version,state,decision_kind,accepted_ref_id,binding_id,updated_at) VALUES ('45454545-4545-4545-4545-454545454545','46464646-4646-4646-4646-464646464646','old-remote','v1','linked','accept','44444444-4444-4444-4444-444444444445','43434343-4343-4343-4343-434343434343',clock_timestamp()); INSERT INTO privacy_authority.held_row_associations VALUES ('external_refs','44444444-4444-4444-4444-444444444445','42424242-4242-4242-4242-424242424242',1);",
      ]);
      await execFile("docker", ["cp", new URL(dispositionContainmentUrl).pathname, `${container}:/tmp/disposition-containment.sql`]);
      await execFile("docker", ["exec", container, "psql", "-v", "ON_ERROR_STOP=1", "postgresql://postgres:owner@localhost:5432/privacy", "-f", "/tmp/disposition-containment.sql"]);
      expect((await sql(["kanon_runtime", "SELECT count(*) FROM integration_reconciliation_dispositions WHERE id='45454545-4545-4545-4545-454545454545'"])).stdout.trim()).toBe("0");
      expect((await sql(["postgres", "SELECT count(*) FROM privacy_authority.held_row_associations WHERE store_kind='integration_reconciliation_disposition' AND row_pk='45454545-4545-4545-4545-454545454545'"])).stdout.trim()).toBe("1");
      const normal = "11111111-1111-1111-1111-111111111111";
      const held = "22222222-2222-2222-2222-222222222222";
      const heldAgain = "33333333-3333-3333-3333-333333333333";
      const row = "44444444-4444-4444-4444-444444444444";
      const visible = "55555555-5555-5555-5555-555555555555";
      const heldMember = "66666666-6666-6666-6666-666666666666";
      const visibleMember = "77777777-7777-7777-7777-777777777777";
      const fixtures = `INSERT INTO issues(id,privacy_held_at,privacy_hold_generation) VALUES ('${normal}',NULL,0),('${held}',now(),1),('${heldAgain}',now(),2); INSERT INTO members VALUES ('${heldMember}'),('${visibleMember}'); INSERT INTO comments VALUES ('${row}','${held}','${heldMember}'),('${visible}','${normal}','${visibleMember}'); INSERT INTO external_refs(id,entity_type,entity_id) VALUES ('${row}','issue','${held}'),('${visible}','project','${normal}'); INSERT INTO integration_sync_work(id,entity_type,entity_id,payload) VALUES ('${row}','comment','${held}','{"body":"raw held"}'),('${visible}','comment','${normal}','{"body":"normal"}'); INSERT INTO domain_event_outbox(id,payload) VALUES ('${row}','{"issueId":"${held}","durationS":120}'),('${visible}','{"issueId":"${normal}","durationS":60}'); INSERT INTO mcp_proposals(id) VALUES ('${row}'),('${visible}'); INSERT INTO privacy_authority.held_row_associations VALUES ('mcp_proposal','${row}','${held}',1),('mcp_proposal','${row}','${heldAgain}',2),('integration_sync_work','${row}','${held}',1),('domain_event_outbox','${row}','${held}',1);`;
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
      expect((await sql(["postgres", "SELECT count(*) FROM issues"])).stdout.trim()).toBe("4");
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
        String(protectedTables.length + 1),
        String(protectedTables.length),
        "t",
        String(protectedTables.length + 1),
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

      const issue = "88888888-8888-8888-8888-888888888888",
        binding = "99999999-9999-9999-9999-999999999999";
      const related = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        project = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        workspace = "12121212-1212-1212-1212-121212121212",
        cycle = "13131313-1313-1313-1313-131313131313";
      const competing = "14141414-1414-1414-1414-141414141414",
        competingProject = "15151515-1515-1515-1515-151515151515",
        competingWorkspace = "16161616-1616-1616-1616-161616161616",
        competingCycle = "17171717-1717-1717-1717-171717171717";
      const unscoped = "18181818-1818-1818-1818-181818181818",
        competingUnscoped = "19191919-1919-1919-1919-191919191919";
      const comment = "20202020-2020-2020-2020-202020202020",
        timeEntry = "21212121-2121-2121-2121-212121212121",
        commentRef = "22222222-2222-2222-2222-222222222222",
        timeRef = "23232323-2323-2323-2323-232323232323",
        commentWork = "24242424-2424-2424-2424-242424242424",
        timeWork = "25252525-2525-2525-2525-252525252525",
        commentApplication = "26262626-2626-2626-2626-262626262626",
        timeApplication = "27272727-2727-2727-2727-272727272727",
        commentConflict = "28282828-2828-2828-2828-282828282828",
        timeConflict = "29292929-2929-2929-2929-292929292929",
        parentOnlyApplication = "2a2a2a2a-2a2a-2a2a-2a2a-2a2a2a2a2a2a",
        parentOnlyConflict = "2b2b2b2b-2b2b-2b2b-2b2b-2b2b2b2b2b2b",
        competingParentApplication = "2c2c2c2c-2c2c-2c2c-2c2c-2c2c2c2c2c2c",
        competingParentConflict = "2d2d2d2d-2d2d-2d2d-2d2d-2d2d2d2d2d2d";
      const disposition = "3a3a3a3a-3a3a-3a3a-3a3a-3a3a3a3a3a3a",
        unrelatedDisposition = "3b3b3b3b-3b3b-3b3b-3b3b-3b3b3b3b3b3b",
        sameBindingDisposition = "3c3c3c3c-3c3c-3c3c-3c3c-3c3c3c3c3c3c";
      const otherIssue = "30303030-3030-3030-3030-303030303030",
        otherBinding = "31313131-3131-3131-3131-313131313131",
        otherComment = "32323232-3232-3232-3232-323232323232",
        otherCommentRef = "33333333-3333-3333-3333-333333333333",
        otherCommentWork = "34343434-3434-3434-3434-343434343434";
      await sql([
        "postgres",
        `INSERT INTO projects VALUES ('${project}','${workspace}'),('${competingProject}','${competingWorkspace}'); INSERT INTO cycles VALUES ('${cycle}','${project}'),('${competingCycle}','${competingProject}'); INSERT INTO issues(id,key,title,description,project_id) VALUES ('${issue}','KAN-246','Private local','Private remote','${project}'),('${otherIssue}','KAN-247','Other local','Other remote','${competingProject}'); INSERT INTO integration_project_bindings VALUES ('${binding}','${project}','active',NULL),('${otherBinding}','${competingProject}','active',NULL); INSERT INTO comments(id,issue_id,body) VALUES ('${comment}','${issue}','private comment body'),('${otherComment}','${otherIssue}','other comment body'); INSERT INTO time_entries(id,issue_id,hours) VALUES ('${timeEntry}','${issue}',7.5); INSERT INTO external_refs(id,entity_type,entity_id,binding_id,external_id,metadata) VALUES ('${related}','issue','${issue}','${binding}','246','{"secret":true}'),('${commentRef}','comment','${comment}','${binding}','comment-246','{"body":"private comment body"}'),('${timeRef}','time_entry','${timeEntry}','${binding}','time-246','{"hours":7.5}'),('${otherCommentRef}','comment','${otherComment}','${otherBinding}','comment-247','{"body":"other comment body"}'); INSERT INTO integration_reconciliation_dispositions(id,preview_identity,remote_issue_id,remote_source_version,state,decision_kind,accepted_ref_id,binding_id,updated_at) VALUES ('${disposition}','${related}','246','v1','linked','accept','${related}','${binding}',clock_timestamp()),('${unrelatedDisposition}','${competing}','247','v1','linked','accept','${otherCommentRef}','${otherBinding}',clock_timestamp()),('${sameBindingDisposition}','${unscoped}','not-held','v1','pending',NULL,NULL,'${binding}',clock_timestamp()); INSERT INTO integration_content_provenance(id,entity_type,entity_id,binding_id,field,origin,content_hash) VALUES ('${related}','issue','${issue}','${binding}','title','kanon','hash'); INSERT INTO integration_sync_work(id,entity_type,entity_id,binding_id,ref_id,payload) VALUES ('${related}','issue','${issue}','${binding}','${related}','{"secret":true}'),('${commentWork}','comment','${comment}','${binding}',NULL,'{"body":"private comment body","issueId":"${issue}","parentRefId":"${commentRef}"}'),('${timeWork}','time_entry','${timeEntry}','${binding}','${timeRef}','{"hours":7.5,"issueId":"${issue}"}'),('${otherCommentWork}','comment','${otherComment}','${otherBinding}','${otherCommentRef}','{"body":"other comment body"}'); INSERT INTO triage_proposals(id,target_issue_id,list_summary) VALUES ('${related}','${issue}','{"secret":true}'); INSERT INTO triage_proposal_contents(id,proposal_id,payload) VALUES ('${related}','${related}','{"secret":true}'); INSERT INTO triage_proposal_lifecycle_events(id,proposal_id,reason,details) VALUES ('${related}','${related}','secret','{"secret":true}'); INSERT INTO mcp_proposals(id,target_ref,workspace_id,project_id) VALUES ('${related}','KAN-246','${workspace}','${project}'),('${unscoped}','KAN-246','${workspace}',NULL),('${competing}','KAN-246','${competingWorkspace}','${competingProject}'),('${competingUnscoped}','KAN-246','${competingWorkspace}',NULL); INSERT INTO cycle_scope_events(id,issue_key,reason,cycle_id) VALUES ('${related}','KAN-246','secret','${cycle}'),('${competing}','KAN-246','competing secret','${competingCycle}'); INSERT INTO admin_audit_logs(id,entity_type,entity_id,payload,reason) VALUES ('${related}','issue','${issue}','{"secret":true}','secret'); INSERT INTO integration_inbound_applications(id,binding_id,ref_id,work_id,remote_entity_type,remote_id,remote_parent_type,remote_parent_id,outcome) VALUES ('${related}','${binding}','${related}','${related}','issue','246',NULL,NULL,'{"secret":true}'),('${commentApplication}','${binding}','${commentRef}','${commentWork}','comment','comment-246',NULL,NULL,'{"body":"private comment outcome"}'),('${timeApplication}','${binding}','${timeRef}','${timeWork}','time_entry','time-246',NULL,NULL,'{"hours":7.5}'),('${parentOnlyApplication}','${binding}',NULL,NULL,'comment','comment-parent-only','issue','246','{"body":"parent-only secret"}'),('${competingParentApplication}','${otherBinding}',NULL,NULL,'comment','other-parent-only','issue','246','{"body":"other binding secret"}'); INSERT INTO integration_conflicts(id,binding_id,application_id,local_evidence,remote_evidence) VALUES ('${related}','${binding}','${related}','{"secret":true}','{"secret":true}'),('${commentConflict}','${binding}','${commentApplication}','{"body":"private local"}','{"body":"private remote"}'),('${timeConflict}','${binding}','${timeApplication}','{"hours":7.5}','{"hours":7.5}'),('${parentOnlyConflict}','${binding}','${parentOnlyApplication}','{"body":"parent-only local"}','{"body":"parent-only remote"}'),('${competingParentConflict}','${otherBinding}','${competingParentApplication}','{"body":"other binding local"}','{"body":"other binding remote"}'); INSERT INTO work_capture_intents(id,issue_id) VALUES ('${related}','${issue}'); INSERT INTO work_capture_owner_leases(id,intent_id) VALUES ('${related}','${related}'); INSERT INTO domain_event_outbox(id,payload,workspace_id) VALUES ('${related}','{"nested":{"issues":["${issue}","${heldAgain}"]}}','${workspace}'),('${competing}','{"nested":{"issueKey":"KAN-246"}}','${competingWorkspace}'); INSERT INTO notifications(id,issue_id,payload) VALUES ('${related}','${issue}','{"secret":true}'); INSERT INTO privacy_authority.held_row_associations VALUES ('domain_event_outbox','${related}','${heldAgain}',2);`,
      ]);
      const token = "cccccccc-cccc-cccc-cccc-cccccccccccc";
      const containment = await sql([
        "kanon_privacy_operator",
        `BEGIN ISOLATION LEVEL SERIALIZABLE; SELECT privacy_authority.prepare_containment('${token}','${issue}','${binding}'); SELECT privacy_authority.commit_containment('${token}','${issue}','${binding}',1,'pq.gcm.v1:key:2:iv:cipher:tag'); COMMIT;`,
      ]);
      expect(containment.stdout).toContain('"status": "prepared"');
      expect(
        (
          await sql([
            "postgres",
            `SELECT title,description IS NULL,privacy_hold_generation,privacy_held_at IS NOT NULL FROM issues WHERE id='${issue}'; SELECT snapshot_schema,count(*) OVER() FROM privacy_quarantine.issue_content WHERE issue_id='${issue}'; SELECT count(*),count(DISTINCT store_kind) FROM privacy_authority.held_row_associations WHERE issue_id='${issue}'; SELECT count(*) FROM privacy_authority.held_row_associations WHERE store_kind='integration_reconciliation_disposition' AND row_pk='${disposition}' AND issue_id='${issue}'; SELECT remote_issue_id,decision_kind,accepted_ref_id FROM integration_reconciliation_dispositions WHERE id='${disposition}'; SELECT count(*) FROM privacy_authority.held_row_associations WHERE store_kind='domain_event_outbox' AND row_pk='${related}'; SELECT metadata IS NULL FROM external_refs WHERE id='${related}'; SELECT payload='{}'::jsonb FROM integration_sync_work WHERE id='${related}'; SELECT outcome IS NULL FROM integration_inbound_applications WHERE id='${related}'; SELECT local_evidence='{}'::jsonb AND remote_evidence='{}'::jsonb FROM integration_conflicts WHERE id='${related}'; SELECT outcome IS NULL FROM integration_inbound_applications WHERE id='${parentOnlyApplication}'; SELECT local_evidence='{}'::jsonb AND remote_evidence='{}'::jsonb FROM integration_conflicts WHERE id='${parentOnlyConflict}'; SELECT outcome FROM integration_inbound_applications WHERE id='${competingParentApplication}'; SELECT local_evidence,remote_evidence FROM integration_conflicts WHERE id='${competingParentConflict}'; SELECT list_summary='{}'::jsonb FROM triage_proposals WHERE id='${related}'; SELECT count(*) FROM triage_proposal_contents WHERE id='${related}'; SELECT reason IS NULL AND details IS NULL FROM triage_proposal_lifecycle_events WHERE id='${related}'; SELECT count(*) FROM mcp_proposals WHERE id='${related}'; SELECT count(*) FROM mcp_proposals WHERE id='${unscoped}'; SELECT issue_key='[privacy hold]' AND reason IS NULL FROM cycle_scope_events WHERE id='${related}'; SELECT payload='{}'::jsonb AND reason IS NULL FROM admin_audit_logs WHERE id='${related}'; SELECT count(*) FROM domain_event_outbox WHERE id='${related}'; SELECT payload IS NULL FROM notifications WHERE id='${related}'; SELECT count(*) FROM mcp_proposals WHERE id='${competing}'; SELECT count(*) FROM mcp_proposals WHERE id='${competingUnscoped}'; SELECT issue_key,reason FROM cycle_scope_events WHERE id='${competing}'; SELECT payload FROM domain_event_outbox WHERE id='${competing}'; SELECT count(*) FROM external_refs WHERE id IN ('${commentRef}','${timeRef}') AND metadata IS NULL; SELECT count(*) FROM integration_sync_work WHERE id IN ('${commentWork}','${timeWork}') AND payload='{}'::jsonb; SELECT count(*) FROM integration_inbound_applications WHERE id IN ('${commentApplication}','${timeApplication}') AND outcome IS NULL; SELECT count(*) FROM integration_conflicts WHERE id IN ('${commentConflict}','${timeConflict}') AND local_evidence='{}'::jsonb AND remote_evidence='{}'::jsonb; SELECT metadata,payload FROM external_refs r JOIN integration_sync_work w ON w.ref_id=r.id WHERE r.id='${otherCommentRef}' AND w.id='${otherCommentWork}';`,
          ])
        ).stdout
          .trim()
          .split("\n")
      ).toEqual([
        "[privacy hold]|t|1|t",
        "2|1",
        "24|13",
        "1",
        `246|accept|${related}`,
        "2",
        "t",
        "t",
        "t",
        "t",
        "t",
        "t",
        '{"body": "other binding secret"}',
        '{"body": "other binding local"}|{"body": "other binding remote"}',
        "t",
        "0",
        "t",
        "0",
        "0",
        "t",
        "t",
        "0",
        "t",
        "1",
        "1",
        "KAN-246|competing secret",
        '{"nested": {"issueKey": "KAN-246"}}',
        "2",
        "2",
        "2",
        "2",
        '{"body": "other comment body"}|{"body": "other comment body"}',
      ]);
      expect(
        (
          await sql(["kanon_runtime", `SELECT count(*) FROM issues WHERE id='${issue}'`])
        ).stdout.trim()
      ).toBe("0");
      expect(
        (
          await sql([
            "kanon_runtime",
            `SELECT count(*) FROM comments WHERE id='${comment}'; SELECT count(*) FROM time_entries WHERE id='${timeEntry}'; SELECT count(*) FROM external_refs WHERE id IN ('${commentRef}','${timeRef}'); SELECT count(*) FROM integration_sync_work WHERE id IN ('${commentWork}','${timeWork}'); SELECT count(*) FROM integration_inbound_applications WHERE id IN ('${commentApplication}','${timeApplication}','${parentOnlyApplication}'); SELECT count(*) FROM integration_conflicts WHERE id IN ('${commentConflict}','${timeConflict}','${parentOnlyConflict}'); SELECT count(*) FROM integration_reconciliation_dispositions WHERE id='${disposition}'; SELECT count(*) FROM integration_reconciliation_dispositions WHERE id='${unrelatedDisposition}'; SELECT body FROM comments WHERE id='${otherComment}'; SELECT hours FROM time_entries WHERE id='${timeEntry}'; SELECT outcome FROM integration_inbound_applications WHERE id='${competingParentApplication}'; SELECT local_evidence FROM integration_conflicts WHERE id='${competingParentConflict}';`,
          ])
        ).stdout
          .trim()
          .split("\n")
      ).toEqual(["0", "0", "0", "0", "0", "0", "0", "1", "other comment body", '{"body": "other binding secret"}', '{"body": "other binding local"}']);
      expect((await sql(["kanon_runtime", `UPDATE integration_reconciliation_dispositions SET decision_kind='changed' WHERE id='${disposition}'; DELETE FROM integration_reconciliation_dispositions WHERE id='${disposition}'; UPDATE integration_reconciliation_dispositions SET decision_kind='updated' WHERE id='${unrelatedDisposition}'; SELECT decision_kind FROM integration_reconciliation_dispositions WHERE id='${unrelatedDisposition}'`])).stdout.trim()).toBe("UPDATE 0\nDELETE 0\nUPDATE 1\nupdated");
      expect((await sql(["postgres", `SELECT decision_kind,accepted_ref_id, count(*) OVER() FROM integration_reconciliation_dispositions WHERE id='${disposition}'`])).stdout.trim()).toBe(`accept|${related}|1`);
      await expect(sql(["kanon_runtime", `UPDATE integration_reconciliation_dispositions SET remote_issue_id='246' WHERE id='${sameBindingDisposition}'`])).rejects.toThrow(/row-level security policy/i);
      await expect(sql(["kanon_runtime", `UPDATE integration_reconciliation_dispositions SET accepted_ref_id='${related}' WHERE id='${sameBindingDisposition}'`])).rejects.toThrow(/row-level security policy/i);
      await expect(sql(["kanon_runtime", `INSERT INTO integration_reconciliation_dispositions(id,preview_identity,remote_issue_id,remote_source_version,state,binding_id,updated_at) VALUES ('3d3d3d3d-3d3d-3d3d-3d3d-3d3d3d3d3d3d','${unscoped}','246','v1','pending','${binding}',clock_timestamp())`])).rejects.toThrow(/row-level security policy/i);
      expect((await sql(["kanon_runtime", `INSERT INTO integration_reconciliation_dispositions(id,preview_identity,remote_issue_id,remote_source_version,state,binding_id,updated_at) VALUES ('3e3e3e3e-3e3e-3e3e-3e3e-3e3e3e3e3e3e','${unscoped}','not-held','v1','pending','${binding}',clock_timestamp())`])).stdout.trim()).toBe("INSERT 0 1");
      expect((await sql(["postgres", `SELECT remote_issue_id,accepted_ref_id FROM integration_reconciliation_dispositions WHERE id='${sameBindingDisposition}'`])).stdout.trim()).toBe("not-held|");
      expect(
        (
          await sql([
            "kanon_privacy_operator",
            `BEGIN; SELECT privacy_authority.prepare_containment('dddddddd-dddd-dddd-dddd-dddddddddddd','${issue}','${binding}'); COMMIT;`,
          ])
        ).stdout
      ).toContain('"status": "contained"');
      expect(
        (
          await sql([
            "postgres",
            `SELECT has_function_privilege('kanon_privacy_operator','privacy_authority.prepare_containment(uuid,uuid,uuid)','EXECUTE'),has_function_privilege('kanon_runtime','privacy_authority.prepare_containment(uuid,uuid,uuid)','EXECUTE'),has_table_privilege('kanon_privacy_operator','privacy_quarantine.issue_content','SELECT');`,
          ])
        ).stdout.trim()
      ).toBe("t|f|f");

      const rollbackIssue = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
        rollbackBinding = "ffffffff-ffff-ffff-ffff-ffffffffffff";
      await sql([
        "postgres",
        `INSERT INTO issues(id,key,title,description,project_id) VALUES ('${rollbackIssue}','KAN-247','Rollback title','Rollback body','${project}'); INSERT INTO integration_project_bindings VALUES ('${rollbackBinding}','${project}','active',NULL); INSERT INTO external_refs(id,entity_type,entity_id,binding_id,external_id,metadata) VALUES ('00000000-0000-0000-0000-000000000001','issue','${rollbackIssue}','${rollbackBinding}','247','{"secret":true}'); INSERT INTO mcp_proposals(id,target_ref) VALUES ('00000000-0000-0000-0000-000000000001','KAN-247'); CREATE FUNCTION fail_privacy_hold() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${rollbackIssue}' AND NEW.privacy_held_at IS NOT NULL THEN RAISE EXCEPTION 'forced rollback'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_privacy_hold BEFORE UPDATE ON issues FOR EACH ROW EXECUTE FUNCTION fail_privacy_hold();`,
      ]);
      await expect(
        sql([
          "kanon_privacy_operator",
          `BEGIN ISOLATION LEVEL SERIALIZABLE; SELECT privacy_authority.prepare_containment('00000000-0000-0000-0000-000000000002','${rollbackIssue}','${rollbackBinding}'); SELECT privacy_authority.commit_containment('00000000-0000-0000-0000-000000000002','${rollbackIssue}','${rollbackBinding}',1,'pq.gcm.v1:key:2:iv:cipher:tag'); COMMIT;`,
        ])
      ).rejects.toThrow(/forced rollback/);
      expect(
        (
          await sql([
            "postgres",
            `SELECT title,description,privacy_hold_generation,privacy_held_at IS NULL FROM issues WHERE id='${rollbackIssue}'; SELECT count(*) FROM privacy_quarantine.issue_content WHERE issue_id='${rollbackIssue}'; SELECT count(*) FROM privacy_authority.held_row_associations WHERE issue_id='${rollbackIssue}'; SELECT count(*) FROM mcp_proposals WHERE target_ref='KAN-247';`,
          ])
        ).stdout
          .trim()
          .split("\n")
      ).toEqual(["Rollback title|Rollback body|0|t", "0", "0", "1"]);
      await sql([
        "postgres",
        "DROP TRIGGER fail_privacy_hold ON issues; DROP FUNCTION fail_privacy_hold();",
      ]);

      const raceIssue = "00000000-0000-0000-0000-000000000003",
        raceBinding = "00000000-0000-0000-0000-000000000004";
      await sql([
        "postgres",
        `INSERT INTO issues(id,key,title,project_id) VALUES ('${raceIssue}','KAN-248','Race title','${project}'); INSERT INTO integration_project_bindings VALUES ('${raceBinding}','${project}','active',NULL); INSERT INTO external_refs(id,entity_type,entity_id,binding_id,external_id) VALUES ('00000000-0000-0000-0000-000000000005','issue','${raceIssue}','${raceBinding}','248');`,
      ]);
      const racingContainment = sql([
        "kanon_privacy_operator",
        `BEGIN ISOLATION LEVEL SERIALIZABLE; SELECT privacy_authority.prepare_containment('00000000-0000-0000-0000-000000000006','${raceIssue}','${raceBinding}'); SELECT pg_sleep(2); SELECT privacy_authority.commit_containment('00000000-0000-0000-0000-000000000006','${raceIssue}','${raceBinding}',1,'pq.gcm.v1:key:2:iv:cipher:tag'); COMMIT;`,
      ]);
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (
          (
            await sql([
              "postgres",
              "SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.usename='kanon_privacy_operator' AND l.mode='ShareRowExclusiveLock' AND l.granted",
            ])
          ).stdout.trim() !== "0"
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await expect(
        sql([
          "kanon_runtime",
          `SET statement_timeout='200ms'; UPDATE issues SET title='raced' WHERE id='${raceIssue}'`,
        ])
      ).rejects.toThrow(/statement timeout/);
      await racingContainment;
      expect(
        (
          await sql([
            "postgres",
            `SELECT title,privacy_hold_generation FROM issues WHERE id='${raceIssue}'`,
          ])
        ).stdout.trim()
      ).toBe("[privacy hold]|1");
    }, 60_000);
  });
});

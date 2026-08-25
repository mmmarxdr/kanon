import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);
const apiRoot = new URL("..", import.meta.url).pathname;
let container = "";

afterEach(async () => {
  if (container) await execFile("docker", ["rm", "-f", container]).catch(() => undefined);
  container = "";
});

async function sql(user: "postgres" | "kanon_runtime", statement: string) {
  const password = user === "postgres" ? "owner" : "runtime";
  return execFile("docker", [
    "exec",
    container,
    "psql",
    "-v",
    "ON_ERROR_STOP=1",
    "-At",
    `postgresql://${user}:${password}@127.0.0.1:5432/privacy`,
    "-c",
    statement,
  ]);
}

describe.runIf(process.env.KAN261_RUN_DISPOSABLE_POSTGRES === "1")(
  "reconciliation privacy visibility on PostgreSQL 16",
  () => {
    it("hides and preserves held candidate recommendations for runtime while retaining owner visibility", async () => {
      container = `kan261_reconciliation_privacy_${process.pid}_${Date.now()}`;
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
        "until pg_isready -U postgres -d privacy >/dev/null 2>&1; do sleep .2; done",
      ]);
      const port = (await execFile("docker", ["port", container, "5432/tcp"])).stdout
        .trim()
        .match(/:(\d+)$/)?.[1];
      expect(port).toMatch(/^\d+$/);
      expect(port).not.toMatch(/^(5432|5433)$/);

      await execFile("pnpm", ["exec", "prisma", "migrate", "deploy"], {
        cwd: apiRoot,
        env: {
          ...process.env,
          DATABASE_URL: `postgresql://postgres:owner@127.0.0.1:${port}/privacy?schema=public`,
        },
      });
      await sql("postgres", "ALTER ROLE kanon_runtime PASSWORD 'runtime'");

      const visibleIssue = "11111111-1111-4111-8111-111111111111";
      const heldIssue = "22222222-2222-4222-8222-222222222222";
      const visibleRecommendation = "33333333-3333-4333-8333-333333333333";
      const heldRecommendation = "44444444-4444-4444-8444-444444444444";
      const binding = "55555555-5555-4555-8555-555555555555";
      const project = "66666666-6666-4666-8666-666666666666";
      await sql(
        "postgres",
        `SET session_replication_role = replica;
         INSERT INTO issues (id,key,sequence_num,title,updated_at,project_id,privacy_held_at,privacy_hold_generation)
         VALUES ('${visibleIssue}','VIS-1',1,'visible',now(),'${project}',NULL,0),
                ('${heldIssue}','HLD-1',2,'held',now(),'${project}',now(),1);
         INSERT INTO integration_reconciliation_recommendations
           (id,remote_issue_id,remote_source_version,score,scoring_version,factor_evidence,local_fingerprint,remote_fingerprint,updated_at,binding_id,candidate_issue_id)
         VALUES ('${visibleRecommendation}','41','source-visible',90,'v1','{}','local-visible','remote-visible',now(),'${binding}','${visibleIssue}'),
                ('${heldRecommendation}','42','source-held',80,'v1','{}','local-held','remote-held',now(),'${binding}','${heldIssue}');
         RESET session_replication_role;`,
      );

      expect(
        (
          await sql(
            "kanon_runtime",
            "SELECT id FROM integration_reconciliation_recommendations ORDER BY id",
          )
        ).stdout.trim(),
      ).toBe(visibleRecommendation);
      await sql(
        "kanon_runtime",
        `UPDATE integration_reconciliation_recommendations SET score=0 WHERE id='${heldRecommendation}';
         DELETE FROM integration_reconciliation_recommendations WHERE id='${heldRecommendation}';`,
      );
      expect(
        (
          await sql(
            "postgres",
            `SELECT id || ':' || score FROM integration_reconciliation_recommendations WHERE id='${heldRecommendation}'`,
          )
        ).stdout.trim(),
      ).toBe(`${heldRecommendation}:80`);
      expect(
        (
          await sql(
            "postgres",
            "SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='integration_reconciliation_recommendations' AND policyname='privacy_runtime_visible' AND roles @> ARRAY['kanon_runtime']::name[] AND cmd='ALL'; SELECT count(*) FROM pg_trigger WHERE tgrelid='public.integration_reconciliation_recommendations'::regclass AND tgname='privacy_runtime_preserve_hidden' AND NOT tgisinternal;",
          )
        ).stdout.trim(),
      ).toBe("1\n1");
    }, 90_000);
  },
);

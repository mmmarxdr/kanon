import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";
import { parseDatabasePrincipalUrls, provisionDatabasePrincipals } from "../src/scripts/one-shot-migrator.js";
const execFile = promisify(execFileCallback);
const disposableName = `kan246_pr2_disposable_${process.pid}_${Date.now()}`;
let startedContainer = false;
afterEach(async () => {
  if (startedContainer) await execFile("docker", ["stop", disposableName]).catch(() => undefined);
});
describe.runIf(process.env.KAN246_RUN_DISPOSABLE_POSTGRES === "1")("database principal proof", () => {
  it("provisions distinct password-authenticated NOBYPASSRLS logins in an isolated PostgreSQL 16 container", async () => {
    const database = `kan246_pr2_disposable_${process.pid}`;
    await execFile("docker", [
      "run", "--rm", "-d", "--name", disposableName,
      "-e", "POSTGRES_USER=owner", "-e", "POSTGRES_PASSWORD=owner-password",
      "-e", `POSTGRES_DB=${database}`, "-p", "127.0.0.1::5432", "postgres:16",
    ]);
    startedContainer = true;
    await execFile("docker", ["exec", disposableName, "sh", "-ec", "until pg_isready -U owner -d " + database + "; do sleep 1; done"]);
    const { stdout } = await execFile("docker", ["port", disposableName, "5432/tcp"]);
    const port = stdout.trim().match(/^127\.0\.0\.1:(\d+)$/)?.[1];
    expect(port).toMatch(/^\d+$/);
    expect(port).not.toMatch(/^(5432|5433)$/);
    const host = `127.0.0.1:${port}`;
    const principals = parseDatabasePrincipalUrls({
      POSTGRES_OWNER_DATABASE_URL: `postgresql://owner:owner-password@${host}/${database}`,
      DATABASE_URL: `postgresql://kanon_runtime:runtime-password@${host}/${database}`,
      PRIVACY_OPERATOR_DATABASE_URL: `postgresql://kanon_privacy_operator:operator-password@${host}/${database}`,
    });
    let provisioned = false;
    for (let attempt = 0; attempt < 30 && !provisioned; attempt += 1) {
      try {
        await provisionDatabasePrincipals(principals);
        provisioned = true;
      } catch (error) {
        if (attempt === 29) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    expect(provisioned).toBe(true);
    const owner = new PrismaClient({ datasourceUrl: principals.owner.toString() });
    try {
      await owner.$executeRawUnsafe("CREATE TABLE public.application_probe (id integer PRIMARY KEY)");
      await owner.$executeRawUnsafe("CREATE TABLE public._prisma_migrations (id text PRIMARY KEY)");
      await execFile("docker", ["cp", fileURLToPath(new URL("./migrations/20260821130000_privacy_database_principals/migration.sql", import.meta.url)), `${disposableName}:/tmp/principals.sql`]);
      await execFile("docker", ["exec", disposableName, "psql", "-v", "ON_ERROR_STOP=1", "-U", "owner", "-d", database, "-f", "/tmp/principals.sql"]);
    } finally {
      await owner.$disconnect();
    }
    for (const url of [principals.runtime, principals.operator]) {
      const client = new PrismaClient({ datasourceUrl: url.toString() });
      try {
        const result = await client.$queryRaw<{ current_user: string; rolbypassrls: boolean; rolcanlogin: boolean }[]>
          `
          SELECT current_user, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = current_user
        `;
        expect(result).toEqual([{ current_user: url.username, rolbypassrls: false, rolcanlogin: true }]);
      } finally {
        await client.$disconnect();
      }
    }
    const runtime = new PrismaClient({ datasourceUrl: principals.runtime.toString() });
    try {
      await runtime.$executeRawUnsafe("INSERT INTO public.application_probe (id) VALUES (1)");
      expect(await runtime.$queryRaw<Array<{ id: number }>>`SELECT id FROM public.application_probe`).toEqual([{ id: 1 }]);
      for (const statement of [
        "SELECT * FROM public._prisma_migrations",
        "INSERT INTO public._prisma_migrations (id) VALUES ('runtime')",
        "UPDATE public._prisma_migrations SET id = 'changed'",
        "DELETE FROM public._prisma_migrations",
      ]) {
        await expect(runtime.$executeRawUnsafe(statement)).rejects.toThrow(/permission denied/i);
      }
    } finally {
      await runtime.$disconnect();
    }
  }, 60_000);
});

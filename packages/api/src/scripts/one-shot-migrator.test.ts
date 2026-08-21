import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  buildRolePasswordStatement,
  createScramSha256Verifier,
  main,
  parseDatabasePrincipalUrls,
  runPrismaMigrate,
} from "./one-shot-migrator.js";
describe("one-shot migrator packaging", () => {
  it("keeps owner credentials in the terminating migrator and gives the API only runtime/operator URLs", async () => {
    const compose = await readFile(new URL("../../../../docker-compose.production.yml", import.meta.url), "utf8");
    const dockerfile = await readFile(new URL("../../Dockerfile", import.meta.url), "utf8");
    expect(compose).toMatch(/kanon-migrate:/);
    expect(compose).toMatch(/POSTGRES_OWNER_DATABASE_URL/);
    expect(compose).toMatch(/condition: service_completed_successfully/);
    expect(dockerfile).toContain("dist/scripts/one-shot-migrator.js");
  });
  it("uses fixed Prisma argv without a shell", async () => {
    const calls: Array<{ command: string; args: string[]; shell: boolean | undefined }> = [];
    await runPrismaMigrate("postgresql://owner:password@db:5432/kanon", (command, args, options) => {
      calls.push({ command, args, shell: options.shell });
      return Promise.resolve(0);
    });
    expect(calls).toEqual([{ command: "prisma", args: ["migrate", "deploy", "--schema=prisma/schema.prisma"], shell: false }]);
  });
  it("uses owner credentials for the fixed external-reference proof command without a shell", async () => {
    const calls: Array<{ command: string; args: string[]; shell: boolean | undefined; databaseUrl: string | undefined }> = [];
    const { runExternalReferenceProof } = await import("./one-shot-migrator.js");
    await runExternalReferenceProof("postgresql://owner:owner-password@db:5432/kanon", (command, args, options) => {
      calls.push({ command, args, shell: options.shell, databaseUrl: options.env.DATABASE_URL });
      return Promise.resolve(0);
    });
    expect(calls).toEqual([{
      command: "node",
      args: ["dist/modules/integrations/backfill.js"],
      shell: false,
      databaseUrl: "postgresql://owner:owner-password@db:5432/kanon",
    }]);
  });
  it("submits a SCRAM verifier rather than a plaintext role password", () => {
    const plaintext = "runtime-password";
    const verifier = createScramSha256Verifier(plaintext);
    const statement = buildRolePasswordStatement("kanon_runtime", verifier);
    expect(verifier).toMatch(/^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]+={0,2}\$[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$/);
    expect(statement).toContain(verifier);
    expect(statement).not.toContain(plaintext);
  });
  it("runs the external-reference proof after principal provisioning and Prisma migration", async () => {
    const calls: string[] = [];
    await main({
      POSTGRES_OWNER_DATABASE_URL: "postgresql://owner:owner-password@db:5432/kanon",
      DATABASE_URL: "postgresql://kanon_runtime:runtime-password@db:5432/kanon",
      PRIVACY_OPERATOR_DATABASE_URL: "postgresql://kanon_privacy_operator:operator-password@db:5432/kanon",
    }, {
      provision: async () => { calls.push("provision"); },
      migrate: async () => { calls.push("migrate"); },
      proveBindings: async () => { calls.push("proof"); },
    });
    expect(calls).toEqual(["provision", "migrate", "proof"]);
  });
  it("fails closed when the external-reference proof fails", async () => {
    await expect(main({
      POSTGRES_OWNER_DATABASE_URL: "postgresql://owner:owner-password@db:5432/kanon",
      DATABASE_URL: "postgresql://kanon_runtime:runtime-password@db:5432/kanon",
      PRIVACY_OPERATOR_DATABASE_URL: "postgresql://kanon_privacy_operator:operator-password@db:5432/kanon",
    }, {
      provision: async () => undefined,
      migrate: async () => undefined,
      proveBindings: async () => { throw new Error("external reference proof failed"); },
    })).rejects.toThrow("external reference proof failed");
  });
  it("rejects reused principal logins", () => {
    expect(() => parseDatabasePrincipalUrls({
      POSTGRES_OWNER_DATABASE_URL: "postgresql://owner:owner-password@db:5432/kanon",
      DATABASE_URL: "postgresql://same:runtime-password@db:5432/kanon",
      PRIVACY_OPERATOR_DATABASE_URL: "postgresql://same:operator-password@db:5432/kanon",
    })).toThrow("distinct login names");
  });
  it.each([
    {
      variable: "DATABASE_URL",
      runtimeUsername: "incorrect_runtime",
      operatorUsername: "kanon_privacy_operator",
      message: "DATABASE_URL must use the kanon_runtime login",
    },
    {
      variable: "PRIVACY_OPERATOR_DATABASE_URL",
      runtimeUsername: "kanon_runtime",
      operatorUsername: "incorrect_operator",
      message: "PRIVACY_OPERATOR_DATABASE_URL must use the kanon_privacy_operator login",
    },
  ])("rejects a distinct but unprovisioned login in $variable", ({ runtimeUsername, operatorUsername, message }) => {
    expect(() => parseDatabasePrincipalUrls({
      POSTGRES_OWNER_DATABASE_URL: "postgresql://owner:owner-password@db:5432/kanon",
      DATABASE_URL: `postgresql://${runtimeUsername}:runtime-password@db:5432/kanon`,
      PRIVACY_OPERATOR_DATABASE_URL: `postgresql://${operatorUsername}:operator-password@db:5432/kanon`,
    })).toThrow(message);
  });
});

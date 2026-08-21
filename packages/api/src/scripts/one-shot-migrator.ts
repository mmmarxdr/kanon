import { spawn } from "node:child_process";
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
type PrincipalUrls = {
  owner: URL;
  runtime: URL;
  operator: URL;
};
type SpawnRunner = (command: string, args: string[], options: { env: NodeJS.ProcessEnv; shell: false }) => Promise<number>;
type MigratorDependencies = {
  provision: (principals: PrincipalUrls) => Promise<void>;
  migrate: (ownerUrl: string) => Promise<void>;
  proveBindings: (ownerUrl: string) => Promise<void>;
};
const SCRAM_ITERATIONS = 4096;
export function createScramSha256Verifier(password: string): string {
  const salt = randomBytes(16);
  const saltedPassword = pbkdf2Sync(password, salt, SCRAM_ITERATIONS, 32, "sha256");
  const clientKey = createHmac("sha256", saltedPassword).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", saltedPassword).update("Server Key").digest();
  return `SCRAM-SHA-256$${SCRAM_ITERATIONS}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}
export function buildRolePasswordStatement(role: "kanon_runtime" | "kanon_privacy_operator", verifier: string): string {
  if (!/^SCRAM-SHA-256\$\d+:[A-Za-z0-9+/]+={0,2}\$[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$/.test(verifier)) {
    throw new Error("Invalid SCRAM-SHA-256 verifier");
  }
  return `ALTER ROLE ${role} PASSWORD '${verifier}'`;
}
function requiredUrl(name: string, value: string | undefined): URL {
  if (!value) throw new Error(`${name} is required`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid PostgreSQL URL`);
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.username || !url.password) {
    throw new Error(`${name} must include a PostgreSQL login and password`);
  }
  return url;
}
export function parseDatabasePrincipalUrls(source: NodeJS.ProcessEnv): PrincipalUrls {
  const principals = {
    owner: requiredUrl("POSTGRES_OWNER_DATABASE_URL", source["POSTGRES_OWNER_DATABASE_URL"]),
    runtime: requiredUrl("DATABASE_URL", source["DATABASE_URL"]),
    operator: requiredUrl("PRIVACY_OPERATOR_DATABASE_URL", source["PRIVACY_OPERATOR_DATABASE_URL"]),
  };
  const names = new Set(Object.values(principals).map((url) => decodeURIComponent(url.username)));
  if (names.size !== 3) throw new Error("Database principal URLs must use distinct login names");
  if (decodeURIComponent(principals.runtime.username) !== "kanon_runtime") {
    throw new Error("DATABASE_URL must use the kanon_runtime login");
  }
  if (decodeURIComponent(principals.operator.username) !== "kanon_privacy_operator") {
    throw new Error("PRIVACY_OPERATOR_DATABASE_URL must use the kanon_privacy_operator login");
  }
  return principals;
}
async function setRolePassword(client: PrismaClient, role: "kanon_runtime" | "kanon_privacy_operator", password: string) {
  await client.$executeRawUnsafe(buildRolePasswordStatement(role, createScramSha256Verifier(password)));
}
export async function provisionDatabasePrincipals(principals: PrincipalUrls): Promise<void> {
  const owner = new PrismaClient({ datasourceUrl: principals.owner.toString() });
  try {
    await owner.$executeRawUnsafe(`DO $$ BEGIN
      CREATE ROLE kanon_runtime LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
    await owner.$executeRawUnsafe(`DO $$ BEGIN
      CREATE ROLE kanon_privacy_operator LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
    await setRolePassword(owner, "kanon_runtime", decodeURIComponent(principals.runtime.password));
    await setRolePassword(owner, "kanon_privacy_operator", decodeURIComponent(principals.operator.password));
  } finally {
    await owner.$disconnect();
  }
}
export const runPrismaMigrate = (ownerUrl: string, runner: SpawnRunner = (command, args, options) => new Promise((resolve, reject) => {
  const child = spawn(command, args, options);
  child.once("error", reject);
  child.once("exit", (code) => resolve(code ?? 1));
})): Promise<void> => runner("prisma", ["migrate", "deploy", "--schema=prisma/schema.prisma"], {
  env: { ...process.env, DATABASE_URL: ownerUrl },
  shell: false,
}).then((code) => {
  if (code !== 0) throw new Error("Prisma migration deployment failed");
});
export const runExternalReferenceProof = (ownerUrl: string, runner: SpawnRunner = (command, args, options) => new Promise((resolve, reject) => {
  const child = spawn(command, args, options);
  child.once("error", reject);
  child.once("exit", (code) => resolve(code ?? 1));
})): Promise<void> => runner("node", ["dist/modules/integrations/backfill.js"], {
  env: { ...process.env, DATABASE_URL: ownerUrl },
  shell: false,
}).then((code) => {
  if (code !== 0) throw new Error("External reference binding proof failed");
});
export async function main(source = process.env, dependencies: MigratorDependencies = {
  provision: provisionDatabasePrincipals,
  migrate: runPrismaMigrate,
  proveBindings: runExternalReferenceProof,
}): Promise<void> {
  const principals = parseDatabasePrincipalUrls(source);
  await dependencies.provision(principals);
  await dependencies.proveBindings(principals.owner.toString());
  await dependencies.migrate(principals.owner.toString());
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error("Migration failed");
    process.exitCode = 1;
  });
}

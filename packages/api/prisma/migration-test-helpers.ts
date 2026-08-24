import { Prisma, PrismaClient } from "@prisma/client";
function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}
export async function createTemporaryMigrationDatabase(
  baseDatabaseUrl: string,
  databaseName: string
) {
  const databaseUrl = new URL(baseDatabaseUrl);
  databaseUrl.pathname = `/${databaseName}`;
  databaseUrl.searchParams.set("schema", "public");
  const adminUrl = new URL(baseDatabaseUrl);
  adminUrl.pathname = "/postgres";
  adminUrl.searchParams.delete("schema");
  const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
  } catch (error) {
    await admin.$disconnect().catch(() => undefined);
    throw new Error(
      "Unable to create an isolated migration test database. The configured PostgreSQL role must have CREATEDB.",
      { cause: error }
    );
  }
  return {
    databaseUrl: databaseUrl.toString(),
    cleanup: async () => {
      try {
        await admin.$executeRaw(Prisma.sql`
          SELECT pg_terminate_backend(pid)
          FROM pg_stat_activity
          WHERE datname = ${databaseName}
            AND pid <> pg_backend_pid()
        `);
        await admin.$executeRawUnsafe(`DROP DATABASE ${quoteIdentifier(databaseName)}`);
      } finally {
        await admin.$disconnect().catch(() => undefined);
      }
    },
  };
}

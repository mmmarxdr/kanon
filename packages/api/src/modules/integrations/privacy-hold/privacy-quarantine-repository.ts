import { Prisma, type PrismaClient } from "@prisma/client";
export type PrivacyQuarantineSnapshot = { readonly issueId: string; readonly bindingId: string; readonly generation: number; readonly payload: string; readonly snapshotSchema?: number };
type Database = Pick<PrismaClient, "$executeRaw" | "$queryRaw">;
export class PrivacyQuarantineUnavailableError extends Error { constructor() { super("quarantine_unavailable"); } }
/** The sole application access point for privacy_quarantine.issue_content. */
export function createPrivacyQuarantineRepository(database: Database) {
  async function store(snapshot: PrivacyQuarantineSnapshot): Promise<void> {
    try {
      const snapshotSchema = snapshot.snapshotSchema ?? 1;
      if (!Number.isSafeInteger(snapshot.generation) || snapshot.generation < 0 || !Number.isSafeInteger(snapshotSchema) || snapshotSchema < 1) throw new Error();
      await database.$executeRaw(Prisma.sql`INSERT INTO "privacy_quarantine"."issue_content" ("issue_id", "binding_id", "generation", "snapshot_schema", "envelope") VALUES (${snapshot.issueId}::uuid, ${snapshot.bindingId}::uuid, ${snapshot.generation}, ${snapshotSchema}, ${snapshot.payload})`);
    } catch { throw new PrivacyQuarantineUnavailableError(); }
  }
  async function reencryptAll(reencrypt: (snapshot: PrivacyQuarantineSnapshot) => string, verify: (snapshot: PrivacyQuarantineSnapshot) => void): Promise<number> {
    try {
      const snapshots = await database.$queryRaw<PrivacyQuarantineSnapshot[]>(Prisma.sql`SELECT "issue_id" AS "issueId", "binding_id" AS "bindingId", "generation", "snapshot_schema" AS "snapshotSchema", "envelope" AS "payload" FROM "privacy_quarantine"."issue_content" FOR UPDATE`);
      for (const snapshot of snapshots) await database.$executeRaw(Prisma.sql`UPDATE "privacy_quarantine"."issue_content" SET "envelope" = ${reencrypt(snapshot)} WHERE "issue_id" = ${snapshot.issueId}::uuid AND "binding_id" = ${snapshot.bindingId}::uuid AND "generation" = ${snapshot.generation}`);
      const readback = await database.$queryRaw<PrivacyQuarantineSnapshot[]>(Prisma.sql`SELECT "issue_id" AS "issueId", "binding_id" AS "bindingId", "generation", "snapshot_schema" AS "snapshotSchema", "envelope" AS "payload" FROM "privacy_quarantine"."issue_content" FOR UPDATE`);
      readback.forEach(verify);
      return readback.length;
    } catch { throw new PrivacyQuarantineUnavailableError(); }
  }
  return { store, reencryptAll };
}

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { encryptPrivacyQuarantine } from "../core/crypto.js";
import { contentHash, type ContentField } from "./content-provenance.js";

type Transaction = Pick<Prisma.TransactionClient, "$queryRaw">;
type Database = {
  $transaction<T>(run: (transaction: Transaction) => Promise<T>, options: { isolationLevel: "Serializable" }): Promise<T>;
};
type Provenance = { field: ContentField; origin: "kanon" | "redmine" | "unknown"; contentHash: string | null };
type Prepared = {
  status: "prepared"; generation: number; title: string; description: string | null;
  provenance: Provenance[];
} | { status: "contained"; generation: number };
type Encrypt = typeof encryptPrivacyQuarantine;

function isPrepared(value: unknown): value is Prepared {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  if (!Number.isSafeInteger(row["generation"]) || Number(row["generation"]) < 1) return false;
  if (row["status"] === "contained") return true;
  if (row["status"] !== "prepared" || typeof row["title"] !== "string"
    || (typeof row["description"] !== "string" && row["description"] !== null)
    || !Array.isArray(row["provenance"])) return false;
  return row["provenance"].every((value) => {
    if (!value || typeof value !== "object") return false;
    const evidence = value as Record<string, unknown>;
    return (evidence["field"] === "title" || evidence["field"] === "description")
      && (evidence["origin"] === "kanon" || evidence["origin"] === "redmine" || evidence["origin"] === "unknown")
      && (typeof evidence["contentHash"] === "string" || evidence["contentHash"] === null);
  });
}

export class PrivacyContainmentUnavailableError extends Error {
  constructor() { super("privacy_hold_unavailable"); this.name = "PrivacyContainmentUnavailableError"; }
}

function snapshotField(field: ContentField, value: string | null, provenance: Provenance[]) {
  const evidence = provenance.find((item) => item.field === field);
  if (!evidence || evidence.contentHash !== contentHash(field, value)) return { origin: "unknown" as const };
  return evidence.origin === "kanon" ? { origin: "kanon" as const, value } : { origin: evidence.origin };
}

export function createAtomicContainment(database: Database, encrypt: Encrypt = encryptPrivacyQuarantine) {
  return async (input: { issueId: string; bindingId: string }) => {
    try {
      return await database.$transaction(async (transaction) => {
        const token = randomUUID();
        const rows = await transaction.$queryRaw<{ value: unknown }[]>(Prisma.sql`
          SELECT privacy_authority.prepare_containment(${token}::uuid, ${input.issueId}::uuid, ${input.bindingId}::uuid) AS value
        `);
        const prepared = rows[0]?.value;
        if (!isPrepared(prepared)) throw new Error();
        if (prepared.status === "contained") return prepared;
        const plaintext = JSON.stringify({ generation: prepared.generation, fields: {
          title: snapshotField("title", prepared.title, prepared.provenance),
          description: snapshotField("description", prepared.description, prepared.provenance),
        } });
        const envelope = encrypt(plaintext, { ...input, generation: prepared.generation }, undefined, 2);
        await transaction.$queryRaw(Prisma.sql`
          SELECT privacy_authority.commit_containment(${token}::uuid, ${input.issueId}::uuid, ${input.bindingId}::uuid, ${prepared.generation}, ${envelope})
        `);
        return { status: "contained" as const, generation: prepared.generation };
      }, { isolationLevel: "Serializable" });
    } catch { throw new PrivacyContainmentUnavailableError(); }
  };
}

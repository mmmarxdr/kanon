import { createHash } from "node:crypto";
import type { IntegrationContentOrigin, Prisma } from "@prisma/client";

const CONTENT_FIELDS = ["title", "description"] as const;
const HASH_DOMAIN = "kanon-content-provenance:v1";

export type ContentField = (typeof CONTENT_FIELDS)[number];
type Database = Pick<Prisma.TransactionClient, "integrationContentProvenance">;

export type IssueContentProvenanceInput = Readonly<{
  bindingId: string;
  issueId: string;
  direction: "outbound" | "inbound";
  actorKind: "user" | "system" | "ai" | "remote";
  sourceVersion: string | null;
  fields: Readonly<Partial<Record<ContentField, string | null>>>;
}>;

export function contentHash(field: ContentField, value: string | null): string {
  const digest = createHash("sha256")
    .update(HASH_DOMAIN)
    .update("\0")
    .update(field)
    .update("\0")
    .update(value === null ? "null" : "string")
    .update("\0")
    .update(value ?? "")
    .digest("hex");
  return `sha256:${digest}`;
}

function evidenceOrigin(input: IssueContentProvenanceInput): IntegrationContentOrigin {
  if (!input.sourceVersion) return "unknown";
  if (input.direction === "inbound" && input.actorKind === "remote") return "redmine";
  if (input.direction === "outbound" && input.actorKind !== "remote") return "kanon";
  return "unknown";
}

export async function recordIssueContentProvenanceTx(
  database: Database,
  input: IssueContentProvenanceInput,
): Promise<void> {
  const origin = evidenceOrigin(input);
  const sourceVersion = origin === "unknown" ? null : input.sourceVersion;
  for (const field of CONTENT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(input.fields, field)) continue;
    const contentHashValue = contentHash(field, input.fields[field] ?? null);
    const identity = {
      bindingId: input.bindingId,
      entityType: "issue" as const,
      entityId: input.issueId,
      field,
    };
    const where = { bindingId_entityType_entityId_field: identity };
    const existing = await database.integrationContentProvenance.findUnique({
      where,
      select: { contentHash: true },
    });
    if (existing?.contentHash === contentHashValue) continue;
    const evidence = {
      origin,
      sourceVersion,
      contentHash: contentHashValue,
    };
    await database.integrationContentProvenance.upsert({
      where,
      create: {
        ...identity,
        ...evidence,
      },
      update: evidence,
    });
  }
}

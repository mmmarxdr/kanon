import { createHash } from "node:crypto";

export const CANONICALIZATION_VERSION = "triage-c14n.v1";
export const TRIAGE_PROPOSAL_CONTRACT_VERSION = "triage-proposal.v1";
export const TRIAGE_PREVIEW_CONTRACT_VERSION = "triage-preview.v1";
export const ISSUE_SEARCH_CONTRACT_VERSION = "issue-search.v1";
export const TRIAGE_PROPOSAL_LIST_CONTRACT_VERSION = "triage-proposal-list.v1";

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface CanonicalOptions {
  readonly setFields?: readonly string[];
  readonly textFields?: readonly string[];
}

function compareCodePoints(left: string, right: string): number {
  const a = Array.from(left);
  const b = Array.from(right);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const difference = a[index]!.codePointAt(0)! - b[index]!.codePointAt(0)!;
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
}

function normalize(value: unknown, options: CanonicalOptions, field?: string): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return typeof value === "string" && options.textFields?.includes(field ?? "") ? value.normalize("NFKC") : value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonical JSON requires finite numbers");
    return value;
  }
  if (typeof value === "undefined" || typeof value === "bigint" || typeof value === "function") throw new TypeError("canonical JSON does not support undefined, bigint, or function values");
  if (Array.isArray(value)) {
    const items = value.map((item) => normalize(item, options, field));
    if (!field || !options.setFields?.includes(field)) return items;
    const unique = new Map(items.map((item) => [JSON.stringify(item), item]));
    return [...unique.entries()].sort(([left], [right]) => compareCodePoints(left, right)).map(([, item]) => item);
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError("canonical JSON accepts JSON objects only");
  const result: Record<string, JsonValue> = {};
  const entries = Object.keys(value as Record<string, unknown>).map((key) => [key, key.normalize("NFKC")] as const).sort(([, left], [, right]) => compareCodePoints(left, right));
  for (const [key, normalizedKey] of entries) {
    if (Object.prototype.hasOwnProperty.call(result, normalizedKey)) throw new TypeError("canonical JSON key collision");
    result[normalizedKey] = normalize((value as Record<string, unknown>)[key], options, key);
  }
  return result;
}

export function canonicalJson(value: unknown, options: CanonicalOptions = {}): string {
  const serialized = JSON.stringify(normalize(value, options));
  if (serialized === undefined) throw new TypeError("canonical JSON value cannot be undefined");
  return serialized;
}

export function canonicalJsonBytes(value: unknown, options: CanonicalOptions = {}): Buffer {
  return Buffer.from(canonicalJson(value, options), "utf8");
}

export function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export interface ProposalIdentityInput {
  readonly contractVersion: string;
  readonly authorizationPolicyVersion: string;
  readonly scope: JsonValue;
  readonly target: JsonValue;
  readonly normalizedPayload: JsonValue;
  readonly generator: JsonValue;
  readonly [ignored: string]: unknown;
}

/** Stable exact identity material. Seal/request/provenance text is intentionally not copied. */
export function proposalIdentityDocument(input: ProposalIdentityInput): JsonValue {
  const target = input.target as Record<string, unknown>;
  return {
    contractVersion: input.contractVersion,
    authorizationPolicyVersion: input.authorizationPolicyVersion,
    scope: input.scope,
    target: {
      issueId: target["issueId"] as JsonValue,
      sourceVersion: target["sourceVersion"] as JsonValue,
      sourceHash: target["sourceHash"] as JsonValue,
    },
    normalizedPayload: input.normalizedPayload,
    generator: input.generator,
  };
}

export function computeProposalIdentity(input: ProposalIdentityInput): string {
  return sha256Hex(
    canonicalJsonBytes(proposalIdentityDocument(input), {
      setFields: ["labels", "labelIds", "actionKinds", "candidateIds"],
      textFields: ["labels"],
    }),
  );
}

export const computeIdentityDigest = computeProposalIdentity;

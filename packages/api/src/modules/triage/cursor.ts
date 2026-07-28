import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync } from "node:crypto";
import { canonicalJson, canonicalJsonBytes } from "./canonical.js";
import { ISSUE_SEARCH_CONTRACT_VERSION, TRIAGE_PROPOSAL_LIST_CONTRACT_VERSION } from "./canonical.js";

const PREFIX = "cur.v1";
const ALGORITHM = "aes-256-gcm";
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export const ISSUE_SEARCH_CURSOR_CONTEXT = ISSUE_SEARCH_CONTRACT_VERSION;
export const TRIAGE_PROPOSAL_LIST_CURSOR_CONTEXT = TRIAGE_PROPOSAL_LIST_CONTRACT_VERSION;

export interface CursorOptions {
  readonly key: string | Buffer;
  readonly context: string;
}

export class CursorValidationError extends Error {
  readonly category: "validation" | "source_conflict" = "validation";
  readonly code: "INVALID_CURSOR" | "CURSOR_SOURCE_CONFLICT" = "INVALID_CURSOR";

  constructor(message = "cursor is invalid") {
    super(message);
    this.name = "CursorValidationError";
  }
}

export class CursorSourceConflictError extends CursorValidationError {
  override readonly category = "source_conflict" as const;
  override readonly code = "CURSOR_SOURCE_CONFLICT" as const;

  constructor(message = "cursor source binding changed") {
    super(message);
    this.name = "CursorSourceConflictError";
  }
}

function rootKey(key: string | Buffer): Buffer {
  return createHash("sha256").update(key).digest();
}

function deriveKey(key: string | Buffer, context: string, purpose: string): Buffer {
  return Buffer.from(
    hkdfSync("sha256", rootKey(key), Buffer.alloc(0), `${PREFIX}:${context}:${purpose}`, 32),
  );
}

function nonceFor(key: string | Buffer, context: string, plaintext: Buffer): Buffer {
  return createHmac("sha256", deriveKey(key, context, "nonce"))
    .update(plaintext)
    .digest()
    .subarray(0, NONCE_BYTES);
}

function aad(context: string): Buffer {
  return Buffer.from(`${PREFIX}:${context}`, "utf8");
}

export function encodeCursor(payload: unknown, options: CursorOptions): string {
  if (!options.context) throw new TypeError("cursor context is required");
  const plaintext = canonicalJsonBytes(payload);
  const nonce = nonceFor(options.key, options.context, plaintext);
  const cipher = createCipheriv(ALGORITHM, deriveKey(options.key, options.context, "encryption"), nonce, {
    authTagLength: AUTH_TAG_BYTES,
  });
  cipher.setAAD(aad(options.context));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return [PREFIX, nonce.toString("base64url"), ciphertext.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}

export function decodeCursor<T = unknown>(token: string, options: CursorOptions): T {
  const parts = token.split(".");
  if (parts.length !== 5 || parts[0] !== "cur" || parts[1] !== "v1") throw new CursorValidationError();
  try {
    const nonce = Buffer.from(parts[2]!, "base64url");
    const ciphertext = Buffer.from(parts[3]!, "base64url");
    const authTag = Buffer.from(parts[4]!, "base64url");
    if (nonce.length !== NONCE_BYTES || authTag.length !== AUTH_TAG_BYTES) throw new Error("shape");
    const decipher = createDecipheriv(ALGORITHM, deriveKey(options.key, options.context, "encryption"), nonce, {
      authTagLength: AUTH_TAG_BYTES,
    });
    decipher.setAAD(aad(options.context));
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    const parsed: unknown = JSON.parse(plaintext);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("payload");
    return parsed as T;
  } catch {
    throw new CursorValidationError();
  }
}

export function validateCursorBindings<T>(
  token: string,
  expected: T,
  options: CursorOptions,
): T {
  const actual = decodeCursor<T>(token, options);
  const actualRecord = actual as Record<string, unknown>;
  const expectedRecord = expected as Record<string, unknown>;
  if (
    "sourceFingerprint" in actualRecord &&
    actualRecord["sourceFingerprint"] !== expectedRecord["sourceFingerprint"]
  ) {
    throw new CursorSourceConflictError();
  }
  if (canonicalJson(actual) !== canonicalJson(expected)) throw new CursorValidationError("cursor bindings do not match");
  return actual;
}

export const createCursor = encodeCursor;
export const parseCursor = decodeCursor;

export function encodeIssueSearchCursor(payload: unknown, key: string | Buffer): string {
  return encodeCursor(payload, { key, context: ISSUE_SEARCH_CURSOR_CONTEXT });
}

export function decodeIssueSearchCursor<T = unknown>(token: string, key: string | Buffer): T {
  return decodeCursor<T>(token, { key, context: ISSUE_SEARCH_CURSOR_CONTEXT });
}

export function encodeProposalListCursor(payload: unknown, key: string | Buffer): string {
  return encodeCursor(payload, { key, context: TRIAGE_PROPOSAL_LIST_CURSOR_CONTEXT });
}

export function decodeProposalListCursor<T = unknown>(token: string, key: string | Buffer): T {
  return decodeCursor<T>(token, { key, context: TRIAGE_PROPOSAL_LIST_CURSOR_CONTEXT });
}

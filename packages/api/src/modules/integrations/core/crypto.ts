/**
 * ADR-0012 — reversible encryption for integration credentials.
 *
 * Per-user provider API keys (e.g. Redmine) must be stored encrypted at rest and
 * decrypted at push time — the codebase otherwise only hashes secrets one-way
 * (sha256/bcrypt), which cannot be reversed. This module provides AES-256-GCM
 * (authenticated) encryption over `node:crypto`, with no third-party dependency.
 *
 * Serialized form (stored in MemberIntegrationCredential.encryptedKey):
 *   `gcm.v1:<ivB64>:<ciphertextB64>:<authTagB64>`
 * Segments are joined with `:` (not part of the base64 alphabet) so the `gcm.v1`
 * version prefix can itself contain a dot without ambiguity.
 * The `gcm.v1` prefix versions the scheme so a future algorithm/key rotation can
 * be detected and migrated without ambiguity.
 *
 * GCM authenticates the ciphertext: any tampering (or a wrong key) makes
 * `decrypt` throw on `final()` — callers must treat a throw as "unusable
 * credential", never as plaintext.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../../../config/env.js";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard nonce length
const KEY_BYTES = 32; // AES-256
const AUTH_TAG_BYTES = 16; // full 128-bit GCM tag — shorter tags weaken authentication
const PREFIX = "gcm.v1";
/** Canonical base64 of a 32-byte key: 43 alphabet chars + one `=` pad. */
const KEY_B64 = /^[A-Za-z0-9+/]{43}=$/;

/** Decode a base64 key string and assert it is exactly 32 bytes (AES-256). */
export function decodeKey(base64Key: string): Buffer {
  // Reject stray/invalid characters BEFORE decoding: Buffer.from(_, "base64")
  // silently drops anything outside the alphabet, which would otherwise turn a
  // copy-paste artifact (newline, space) into a different-but-still-32-byte key
  // with no warning — a silent key-rotation footgun.
  if (!KEY_B64.test(base64Key)) {
    throw new Error(
      "integration encryption key must be a base64-encoded 32 bytes (43 base64 chars + '=')",
    );
  }
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `integration encryption key must decode to ${KEY_BYTES} bytes, got ${key.length}`,
    );
  }
  return key;
}

/**
 * Load the configured encryption key from env. Throws when unset — in dev/test
 * the env var is optional (see env.ts), so code paths that actually encrypt must
 * either run with the key configured or pass an explicit key (tests do the latter).
 */
export function loadEncryptionKey(): Buffer {
  const raw = env.INTEGRATION_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "INTEGRATION_ENCRYPTION_KEY is not set — cannot encrypt/decrypt integration credentials",
    );
  }
  return decodeKey(raw);
}

/** Generate a fresh base64-encoded 32-byte key (ops / key rotation / tests). */
export function generateEncryptionKey(): string {
  return randomBytes(KEY_BYTES).toString("base64");
}

/** Encrypt UTF-8 plaintext → versioned, self-describing serialized string. */
export function encrypt(plaintext: string, key: Buffer = loadEncryptionKey()): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    PREFIX,
    iv.toString("base64"),
    ciphertext.toString("base64"),
    authTag.toString("base64"),
  ].join(":");
}

/**
 * Decrypt a string produced by `encrypt`. Throws on a malformed payload, a
 * wrong key, or any tampering (GCM auth-tag verification fails in `final()`).
 */
export function decrypt(serialized: string, key: Buffer = loadEncryptionKey()): string {
  const parts = serialized.split(":");
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new Error("malformed integration ciphertext: expected `gcm.v1:<iv>:<ct>:<tag>`");
  }
  const [, ivB64, ctB64, tagB64] = parts as [string, string, string, string];
  const iv = Buffer.from(ivB64, "base64");
  const ciphertext = Buffer.from(ctB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  if (iv.length !== IV_BYTES) {
    throw new Error("malformed integration ciphertext: bad iv length");
  }
  // Enforce the full 128-bit tag explicitly. Node accepts shorter GCM tags
  // (4/8 bytes), which would let a tampered/short-tag payload downgrade
  // authentication; reject anything that isn't the 16-byte tag we emit.
  if (authTag.length !== AUTH_TAG_BYTES) {
    throw new Error("malformed integration ciphertext: auth tag must be 16 bytes");
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export type PrivacyQuarantineAad = { readonly issueId: string; readonly bindingId: string; readonly generation: number };
export type PrivacyQuarantineKeyring = { readonly currentKeyId: string; readonly keys: Readonly<Record<string, Buffer>> };
const PRIVACY_PREFIX = "pq.gcm.v1";

/** Secret-free boundary for missing, malformed, wrong, or tampered quarantine data. */
export class QuarantineUnavailableError extends Error {
  constructor() { super("quarantine_unavailable"); this.name = "QuarantineUnavailableError"; }
}

export function parsePrivacyQuarantineKeyring(input: { currentKeyId: string; keys: Record<string, string> }): PrivacyQuarantineKeyring {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(input.currentKeyId)) throw new QuarantineUnavailableError();
  try {
    const keys = Object.fromEntries(Object.entries(input.keys).map(([id, key]) => {
      if (!/^[A-Za-z0-9._-]{1,64}$/.test(id)) throw new Error("invalid key id");
      return [id, decodeKey(key)];
    }));
    if (!keys[input.currentKeyId]) throw new Error("missing current key");
    return { currentKeyId: input.currentKeyId, keys };
  } catch { throw new QuarantineUnavailableError(); }
}

export function loadPrivacyQuarantineKeyring(): PrivacyQuarantineKeyring {
  if (!env.PRIVACY_QUARANTINE_KEYRING) throw new QuarantineUnavailableError();
  return parsePrivacyQuarantineKeyring(env.PRIVACY_QUARANTINE_KEYRING);
}

function isCanonicalBase64(value: string): boolean {
  return Buffer.from(value, "base64").toString("base64") === value;
}

function quarantineAad(aad: PrivacyQuarantineAad, snapshotSchema: number): Buffer {
  if (!Number.isSafeInteger(aad.generation) || aad.generation < 0 || !Number.isSafeInteger(snapshotSchema) || snapshotSchema < 1) throw new QuarantineUnavailableError();
  return Buffer.from(JSON.stringify(["privacy_quarantine", aad.issueId, aad.bindingId, aad.generation, snapshotSchema]));
}

export function encryptPrivacyQuarantine(plaintext: string, aad: PrivacyQuarantineAad, keyring = loadPrivacyQuarantineKeyring(), snapshotSchema = 1): string {
  try {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, keyring.keys[keyring.currentKeyId]!, iv, { authTagLength: AUTH_TAG_BYTES });
    cipher.setAAD(quarantineAad(aad, snapshotSchema));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return [PRIVACY_PREFIX, keyring.currentKeyId, snapshotSchema, iv.toString("base64"), ciphertext.toString("base64"), cipher.getAuthTag().toString("base64")].join(":");
  } catch { throw new QuarantineUnavailableError(); }
}

export function decryptPrivacyQuarantine(envelope: string, aad: PrivacyQuarantineAad, keyring = loadPrivacyQuarantineKeyring()): string {
  try {
    const [prefix, keyId, schemaText, ivB64, ciphertextB64, tagB64, ...extra] = envelope.split(":");
    const snapshotSchema = Number(schemaText);
    const key = !extra.length && prefix === PRIVACY_PREFIX && keyId ? keyring.keys[keyId] : undefined;
    const iv = Buffer.from(ivB64 ?? "", "base64"), tag = Buffer.from(tagB64 ?? "", "base64");
    if (!key || String(snapshotSchema) !== schemaText || !isCanonicalBase64(ivB64 ?? "") || !isCanonicalBase64(ciphertextB64 ?? "") || !isCanonicalBase64(tagB64 ?? "") || iv.length !== IV_BYTES || tag.length !== AUTH_TAG_BYTES) throw new Error("unavailable");
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });
    decipher.setAAD(quarantineAad(aad, snapshotSchema)); decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(ciphertextB64 ?? "", "base64")), decipher.final()]).toString("utf8");
  } catch { throw new QuarantineUnavailableError(); }
}

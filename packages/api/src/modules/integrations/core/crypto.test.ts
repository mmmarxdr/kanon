import { describe, it, expect } from "vitest";
import {
  encrypt, decrypt, decodeKey, generateEncryptionKey,
  decryptPrivacyQuarantine, encryptPrivacyQuarantine, parsePrivacyQuarantineKeyring, QuarantineUnavailableError,
} from "./crypto.js";

// Explicit key per test so these never depend on env.INTEGRATION_ENCRYPTION_KEY
// (optional in dev/test).
const key = decodeKey(generateEncryptionKey());

describe("integrations/core/crypto — AES-256-GCM", () => {
  it("round-trips plaintext", () => {
    const secret = "0123456789abcdef0123456789abcdef01234567"; // shape of a Redmine key
    expect(decrypt(encrypt(secret, key), key)).toBe(secret);
  });

  it("round-trips unicode + empty string", () => {
    expect(decrypt(encrypt("héllo · 漢字 · 🔐", key), key)).toBe("héllo · 漢字 · 🔐");
    expect(decrypt(encrypt("", key), key)).toBe("");
  });

  it("produces a different ciphertext each call (random IV)", () => {
    const a = encrypt("same", key);
    const b = encrypt("same", key);
    expect(a).not.toBe(b);
    expect(decrypt(a, key)).toBe("same");
    expect(decrypt(b, key)).toBe("same");
  });

  it("emits the versioned gcm.v1 envelope", () => {
    const parts = encrypt("x", key).split(":");
    expect(parts[0]).toBe("gcm.v1");
    expect(parts).toHaveLength(4); // gcm.v1 : iv : ct : tag
  });

  it("fails to decrypt with a different key", () => {
    const other = decodeKey(generateEncryptionKey());
    const ct = encrypt("secret", key);
    expect(() => decrypt(ct, other)).toThrow();
  });

  it("detects tampering with the ciphertext (auth tag)", () => {
    const [prefix, iv, ct, tag] = encrypt("secret", key).split(":") as [
      string,
      string,
      string,
      string,
    ];
    // flip a byte in the ciphertext segment
    const tampered = Buffer.from(ct, "base64");
    tampered[0] = tampered[0]! ^ 0xff;
    const forged = [prefix, iv, tampered.toString("base64"), tag].join(":");
    expect(() => decrypt(forged, key)).toThrow();
  });

  it("detects tampering with the auth tag", () => {
    const [prefix, iv, ct, tag] = encrypt("secret", key).split(":") as [
      string,
      string,
      string,
      string,
    ];
    const tampered = Buffer.from(tag, "base64");
    tampered[0] = tampered[0]! ^ 0xff;
    const forged = [prefix, iv, ct, tampered.toString("base64")].join(":");
    expect(() => decrypt(forged, key)).toThrow();
  });

  it("rejects malformed payloads", () => {
    expect(() => decrypt("not-a-ciphertext", key)).toThrow(/malformed/);
    expect(() => decrypt("gcm.v1:only:three", key)).toThrow(/malformed/);
    expect(() => decrypt("aes.v9:a:b:c", key)).toThrow(/malformed/);
  });

  it("rejects truncated/downgraded auth tags (4-byte and 8-byte)", () => {
    const [prefix, iv, ct, tag] = encrypt("secret", key).split(":") as [
      string,
      string,
      string,
      string,
    ];
    const fullTag = Buffer.from(tag, "base64");
    const shortTag = fullTag.subarray(0, 4).toString("base64");
    const eightTag = fullTag.subarray(0, 8).toString("base64");
    expect(() => decrypt([prefix, iv, ct, shortTag].join(":"), key)).toThrow(/auth tag/);
    expect(() => decrypt([prefix, iv, ct, eightTag].join(":"), key)).toThrow(/auth tag/);
    expect(() => decrypt([prefix, iv, ct, ""].join(":"), key)).toThrow(/auth tag/);
  });

  it("decodeKey rejects keys that are not exactly 32 bytes", () => {
    expect(() => decodeKey(Buffer.alloc(16).toString("base64"))).toThrow(/32/);
    expect(() => decodeKey(Buffer.alloc(31).toString("base64"))).toThrow(/32/);
    expect(() => decodeKey(Buffer.alloc(33).toString("base64"))).toThrow(/32/);
  });

  it("decodeKey rejects keys with non-base64 characters (silent-truncation footgun)", () => {
    // 44-char string with a stray '!' — Buffer.from would silently drop it.
    const sneaky = "!" + generateEncryptionKey().slice(1);
    expect(() => decodeKey(sneaky)).toThrow();
    expect(() => decodeKey(generateEncryptionKey() + "\n")).toThrow();
  });

  it("encrypt without an explicit key throws when INTEGRATION_ENCRYPTION_KEY is unset", () => {
    // env var is unset in the test environment → the env-backed default key load fails.
    expect(() => encrypt("secret")).toThrow(/INTEGRATION_ENCRYPTION_KEY/);
  });

  it("generateEncryptionKey yields distinct base64 32-byte keys", () => {
    const a = generateEncryptionKey();
    const b = generateEncryptionKey();
    expect(Buffer.from(a, "base64")).toHaveLength(32);
    expect(a).not.toBe(b);
  });
});


describe("privacy quarantine keyring envelopes", () => {
  const keyring = parsePrivacyQuarantineKeyring({
    currentKeyId: "v2",
    keys: { v1: generateEncryptionKey(), v2: generateEncryptionKey() },
  });
  const aad = { issueId: "issue-1", bindingId: "binding-1", generation: 4 };

  it("uses the current key and binds issue, binding, and generation as AAD", () => {
    const envelope = encryptPrivacyQuarantine('{"title":"secret"}', aad, keyring);
    expect(envelope.startsWith("pq.gcm.v1:v2:1:")).toBe(true);
    expect(decryptPrivacyQuarantine(envelope, aad, keyring)).toBe('{"title":"secret"}');
    expect(() => decryptPrivacyQuarantine(envelope, { ...aad, generation: 5 }, keyring)).toThrow(QuarantineUnavailableError);
  });

  it("retains old keys but returns a secret-free failure for missing or tampered data", () => {
    const oldEnvelope = encryptPrivacyQuarantine("old", aad, { ...keyring, currentKeyId: "v1" });
    expect(decryptPrivacyQuarantine(oldEnvelope, aad, keyring)).toBe("old");
    expect(() => decryptPrivacyQuarantine(oldEnvelope, aad, { ...keyring, keys: { v2: keyring.keys.v2 } })).toThrow("quarantine_unavailable");
    expect(() => decryptPrivacyQuarantine(`${oldEnvelope}x`, aad, keyring)).toThrow("quarantine_unavailable");
  });
});

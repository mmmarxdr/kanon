import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// These imports will fail until file-store.ts is created (TDD red phase)
import { FileCredentialStore } from "./file-store.js";
import type { Creds } from "./types.js";

const VALID_CREDS: Creds = {
  server: "https://server.example.com",
  refreshToken: "eyJhbGciOiJIUzI1NiJ9.payload.sig",
  email: "dev@example.com",
  savedAt: "2026-04-28T12:00:00.000Z",
};

describe("FileCredentialStore", () => {
  let tmpDir: string;
  let store: FileCredentialStore;

  beforeEach(() => {
    // Use a fresh tmp directory per test — never touches real ~/.kanon
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kanon-cred-test-"));
    store = new FileCredentialStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── readCredentials ──────────────────────────────────────────────────────────

  it("returns null when credentials file does not exist", async () => {
    const result = await store.readCredentials("https://server.example.com");
    expect(result).toBeNull();
  });

  it("returns null when credentials file contains malformed JSON (no throw)", async () => {
    const credFile = path.join(tmpDir, "credentials");
    fs.writeFileSync(credFile, "{ this is not valid json }", "utf8");
    const result = await store.readCredentials("https://server.example.com");
    expect(result).toBeNull();
  });

  it("returns null when server key is absent in a valid credentials file", async () => {
    const credFile = path.join(tmpDir, "credentials");
    const data = { "https://other.example.com": VALID_CREDS };
    fs.writeFileSync(credFile, JSON.stringify(data), "utf8");
    const result = await store.readCredentials("https://server.example.com");
    expect(result).toBeNull();
  });

  // ── writeCredentials ─────────────────────────────────────────────────────────

  it("write then read returns the same credentials", async () => {
    await store.writeCredentials("https://server.example.com", VALID_CREDS);
    const result = await store.readCredentials("https://server.example.com");
    expect(result).toEqual(VALID_CREDS);
  });

  it("creates ~/.kanon/ directory with mode 0700 if absent", async () => {
    // tmpDir itself exists, but we point store at a nested dir that doesn't
    const nestedHome = path.join(tmpDir, "newhome");
    const nestedStore = new FileCredentialStore(nestedHome);
    await nestedStore.writeCredentials("https://server.example.com", VALID_CREDS);

    const kanoDir = path.join(nestedHome, ".kanon");
    const stat = fs.statSync(kanoDir);
    expect(stat.isDirectory()).toBe(true);
    expect(stat.mode & 0o777).toBe(0o700);
  });

  it("writes credentials file with mode 0600", async () => {
    await store.writeCredentials("https://server.example.com", VALID_CREDS);
    const credFile = path.join(tmpDir, ".kanon", "credentials");
    const stat = fs.statSync(credFile);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("overwrites existing credentials for same server", async () => {
    const first: Creds = { ...VALID_CREDS, refreshToken: "old-token" };
    const second: Creds = { ...VALID_CREDS, refreshToken: "new-token" };

    await store.writeCredentials("https://server.example.com", first);
    await store.writeCredentials("https://server.example.com", second);

    const result = await store.readCredentials("https://server.example.com");
    expect(result?.refreshToken).toBe("new-token");
  });

  it("preserves other servers when writing a new one (multi-server coexistence)", async () => {
    const credsA: Creds = { ...VALID_CREDS, refreshToken: "token-a", server: "https://a.example.com" };
    const credsB: Creds = { ...VALID_CREDS, refreshToken: "token-b", server: "https://b.example.com" };

    await store.writeCredentials("https://a.example.com", credsA);
    await store.writeCredentials("https://b.example.com", credsB);

    expect(await store.readCredentials("https://a.example.com")).toEqual(credsA);
    expect(await store.readCredentials("https://b.example.com")).toEqual(credsB);
  });

  // ── clearCredentials ─────────────────────────────────────────────────────────

  it("clear removes only the specified server, keeping other entries", async () => {
    const credsA: Creds = { ...VALID_CREDS, refreshToken: "token-a", server: "https://a.example.com" };
    const credsB: Creds = { ...VALID_CREDS, refreshToken: "token-b", server: "https://b.example.com" };

    await store.writeCredentials("https://a.example.com", credsA);
    await store.writeCredentials("https://b.example.com", credsB);
    await store.clearCredentials("https://a.example.com");

    expect(await store.readCredentials("https://a.example.com")).toBeNull();
    expect(await store.readCredentials("https://b.example.com")).toEqual(credsB);
  });

  it("clear deletes the file when removing the last entry", async () => {
    await store.writeCredentials("https://server.example.com", VALID_CREDS);
    await store.clearCredentials("https://server.example.com");

    const credFile = path.join(tmpDir, ".kanon", "credentials");
    expect(fs.existsSync(credFile)).toBe(false);
  });

  it("clear is idempotent — clearing a missing file is a no-op (no throw)", async () => {
    await expect(
      store.clearCredentials("https://server.example.com")
    ).resolves.toBeUndefined();
  });

  it("clear is idempotent — clearing a missing key is a no-op (no throw)", async () => {
    await store.writeCredentials("https://server.example.com", VALID_CREDS);
    await expect(
      store.clearCredentials("https://other.example.com")
    ).resolves.toBeUndefined();
    expect(await store.readCredentials("https://server.example.com")).toEqual(VALID_CREDS);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

  it("applies an owner-only Windows DACL without requesting ownership or audit privileges", async () => {
    const runCommand = vi.fn(async () => undefined);
    const powerShellPath = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
    const windowsStore = new FileCredentialStore(tmpDir, {
      platform: "win32",
      powerShellPath,
      runCommand,
    });

    await windowsStore.writeCredentials("https://server.example.com", VALID_CREDS);

    expect(runCommand).toHaveBeenCalledTimes(2);
    for (const [command, args] of runCommand.mock.calls) {
      expect(command).toBe(powerShellPath);
      expect(args).toContain("-EncodedCommand");
      const encoded = args[args.indexOf("-EncodedCommand") + 1]!;
      const script = Buffer.from(encoded, "base64").toString("utf16le");
      expect(script).toContain("WindowsIdentity]::GetCurrent().User");
      expect(script).toContain("SetAccessRuleProtection($true,$false)");
      expect(script).not.toContain("SetOwner(");
      expect(script).not.toMatch(/AuditRule|Sacl|SecurityInfos.*Audit/i);
      expect(script).toContain("$acl.AddAccessRule($rule)");
      expect(script).not.toContain("icacls");
      expect(script).not.toContain("Set-Acl");
      expect(script).toMatch(/\[System\.IO\.(Directory|File)\]::SetAccessControl/);
    }
    const directoryScript = Buffer.from(
      runCommand.mock.calls[0]![1].at(-1)!,
      "base64",
    ).toString("utf16le");
    const fileScript = Buffer.from(
      runCommand.mock.calls[1]![1].at(-1)!,
      "base64",
    ).toString("utf16le");
    expect(directoryScript).toContain("DirectorySecurity");
    expect(fileScript).toContain("FileSecurity");
  });

  it("does not write the refresh token when the Windows directory ACL fails", async () => {
    const windowsStore = new FileCredentialStore(tmpDir, {
      platform: "win32",
      runCommand: vi.fn().mockRejectedValue(new Error("access denied")),
    });

    await expect(
      windowsStore.writeCredentials("https://server.example.com", VALID_CREDS),
    ).rejects.toThrow(/secure.*access denied/i);
    expect(fs.existsSync(path.join(tmpDir, ".kanon", "credentials"))).toBe(false);
  });

  it("keeps existing credentials unchanged when the temp-file ACL fails", async () => {
    const kanoDir = path.join(tmpDir, ".kanon");
    const credFile = path.join(kanoDir, "credentials");
    fs.mkdirSync(kanoDir);
    fs.writeFileSync(credFile, "existing-credentials");
    const runCommand = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("file ACL failed"));
    const windowsStore = new FileCredentialStore(tmpDir, {
      platform: "win32",
      runCommand,
    });

    await expect(
      windowsStore.writeCredentials("https://server.example.com", VALID_CREDS),
    ).rejects.toThrow(/file ACL failed/);
    expect(fs.readFileSync(credFile, "utf8")).toBe("existing-credentials");
    expect(fs.readdirSync(kanoDir)).toEqual(["credentials"]);
  });

  it("keeps existing credentials unchanged when atomic rename fails", async () => {
    const kanoDir = path.join(tmpDir, ".kanon");
    const credFile = path.join(kanoDir, "credentials");
    fs.mkdirSync(kanoDir);
    fs.writeFileSync(credFile, "existing-credentials");
    const windowsStore = new FileCredentialStore(tmpDir, {
      platform: "win32",
      runCommand: vi.fn().mockResolvedValue(undefined),
      renameFile: vi.fn().mockRejectedValue(new Error("rename failed")),
    });

    await expect(
      windowsStore.writeCredentials("https://server.example.com", VALID_CREDS),
    ).rejects.toThrow(/rename failed/);
    expect(fs.readFileSync(credFile, "utf8")).toBe("existing-credentials");
    expect(fs.readdirSync(kanoDir)).toEqual(["credentials"]);
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

  // ── listServers ──────────────────────────────────────────────────────────────

  it("listServers returns empty array when credentials file does not exist", async () => {
    const result = await store.listServers();
    expect(result).toEqual([]);
  });

  it("listServers returns all server keys from the credentials file", async () => {
    const credsA: Creds = { ...VALID_CREDS, server: "https://a.example.com" };
    const credsB: Creds = { ...VALID_CREDS, server: "https://b.example.com" };

    await store.writeCredentials("https://a.example.com", credsA);
    await store.writeCredentials("https://b.example.com", credsB);

    const result = await store.listServers();
    expect(result.sort()).toEqual([
      "https://a.example.com",
      "https://b.example.com",
    ]);
  });

  it("listServers returns empty array for malformed credentials file", async () => {
    const credFile = path.join(tmpDir, ".kanon", "credentials");
    fs.mkdirSync(path.join(tmpDir, ".kanon"), { recursive: true });
    fs.writeFileSync(credFile, "{ not valid json }", "utf8");

    const result = await store.listServers();
    expect(result).toEqual([]);
  });
});

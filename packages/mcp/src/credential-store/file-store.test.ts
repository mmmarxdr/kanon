import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileCredentialStore } from "./file-store.js";

describe("MCP FileCredentialStore Windows ACL", () => {
  const homes: string[] = [];

  afterEach(() => {
    for (const home of homes.splice(0)) {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("uses system PowerShell and keeps an existing file on temp ACL failure", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "kanon-mcp-acl-"));
    homes.push(home);
    const kanoDir = path.join(home, ".kanon");
    const credFile = path.join(kanoDir, "credentials");
    fs.mkdirSync(kanoDir);
    fs.writeFileSync(credFile, "existing-credentials");
    const runCommand = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("acl failed"));
    const store = new FileCredentialStore(home, {
      platform: "win32",
      runCommand,
    });

    await expect(store.writeCredentials("https://api.test", {
      server: "https://api.test",
      refreshToken: "secret",
      email: "dev@example.com",
      savedAt: "2026-07-30T00:00:00.000Z",
    })).rejects.toThrow(/secure.*acl failed/i);
    expect(runCommand.mock.calls[0]![0]).toMatch(
      /C:\\Windows\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/i,
    );
    const script = Buffer.from(runCommand.mock.calls[0]![1].at(-1)!, "base64")
      .toString("utf16le");
    expect(script).toContain("WindowsIdentity]::GetCurrent().User");
    expect(script).toContain("SetAccessRuleProtection($true,$false)");
    expect(fs.readFileSync(credFile, "utf8")).toBe("existing-credentials");
    expect(fs.readdirSync(kanoDir)).toEqual(["credentials"]);
  });
});

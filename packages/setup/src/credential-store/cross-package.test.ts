import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileCredentialStore as SetupStore } from "./file-store.js";
import { FileCredentialStore as McpStore } from "../../../mcp/src/credential-store/file-store.js";

describe("setup/MCP credential format parity", () => {
  const homes: string[] = [];

  afterEach(() => {
    for (const home of homes.splice(0)) {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("reads setup-written credentials from the MCP wrapper store", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "kanon-credential-parity-"));
    homes.push(home);
    const creds = {
      server: "https://server.example.com",
      refreshToken: "refresh-secret",
      email: "dev@example.com",
      savedAt: "2026-07-30T00:00:00.000Z",
    };

    await new SetupStore(home).writeCredentials("https://SERVER.example.com/", creds);
    await expect(new McpStore(home).readCredentials("https://server.example.com"))
      .resolves.toEqual(creds);
  });
});

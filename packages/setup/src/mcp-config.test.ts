/**
 * mcp-config.test.ts — characterization tests for buildWrapperMcpEntry
 * + key-parity proof: setup write-key === mcp read-key (byte-identical).
 *
 * KAN-35: The credential-store key used when writing (setup/onboard) and
 * reading (mcp/wrapper) MUST be byte-identical when both apply canonicalization.
 * Any drift here causes the wrapper to fail silently (no credentials found).
 */
import { describe, it, expect } from "vitest";
import { canonicalizeApiUrl } from "./canonical-url.js";
import { buildWrapperMcpEntry } from "./mcp-config.js";

describe("canonicalizeApiUrl parity: setup write-key === mcp read-key", () => {
  /**
   * These cases represent real-world scenarios where the same server may be
   * specified with different surface forms. Both sides MUST produce the same key.
   */
  const parityMatrix: Array<[string, string, string]> = [
    [
      "trailing-slash variant produces same key",
      "https://server.example.com",
      "https://server.example.com/",
    ],
    [
      "explicit :443 produces same key as no-port",
      "https://server.example.com",
      "https://server.example.com:443",
    ],
    [
      "mixed case host produces same key",
      "https://server.example.com",
      "https://SERVER.EXAMPLE.COM",
    ],
    [
      "path suffix stripped — same key as bare origin",
      "https://server.example.com",
      "https://server.example.com/api/v1",
    ],
  ];

  for (const [label, canonForm, driftForm] of parityMatrix) {
    it(label, () => {
      const setupWriteKey = canonicalizeApiUrl(canonForm);
      const mcpReadKey = canonicalizeApiUrl(driftForm);
      expect(mcpReadKey).toBe(setupWriteKey);
    });
  }

  it("both sides arrive at the same key byte-for-byte (localhost with port)", () => {
    // setup writes credentials keyed by canonicalize(data.apiUrl)
    const serverResponse = "http://localhost:3000/";
    const setupWriteKey = canonicalizeApiUrl(serverResponse);

    // mcp reads credentials by canonicalize(--server arg)
    const wrapperServerArg = "http://localhost:3000";
    const mcpReadKey = canonicalizeApiUrl(wrapperServerArg);

    expect(setupWriteKey).toBe("http://localhost:3000");
    expect(mcpReadKey).toBe("http://localhost:3000");
    expect(setupWriteKey).toBe(mcpReadKey);
  });
});

describe("buildWrapperMcpEntry includes canonicalized --server arg", () => {
  it("wrapper entry args contain the canonical server url (no trailing slash)", () => {
    const entry = buildWrapperMcpEntry(
      "https://server.example.com/",
      "direct",
      "/usr/bin/node",
      { mode: "local", path: "/usr/local/bin/wrapper-cli.js" },
    );
    // The --server arg must be canonicalized so the wrapper's credential lookup
    // matches what setup wrote.
    const serverIdx = entry.args.indexOf("--server");
    expect(serverIdx).toBeGreaterThanOrEqual(0);
    const serverArg = entry.args[serverIdx + 1];
    expect(serverArg).toBe("https://server.example.com");
  });

  it("wrapper entry for wsl-bridge mode uses canonicalized --server arg", () => {
    const entry = buildWrapperMcpEntry(
      "https://server.example.com/",
      "wsl-bridge",
      "/usr/bin/node",
      { mode: "local", path: "/usr/local/bin/wrapper-cli.js" },
    );
    const serverIdx = entry.args.indexOf("--server");
    expect(serverIdx).toBeGreaterThanOrEqual(0);
    const serverArg = entry.args[serverIdx + 1];
    expect(serverArg).toBe("https://server.example.com");
  });
});

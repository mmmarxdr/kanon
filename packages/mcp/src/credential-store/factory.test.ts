import { describe, expect, it } from "vitest";
import { FileCredentialStore } from "./file-store.js";
import { getCredentialStore } from "./factory.js";

describe("MCP getCredentialStore", () => {
  for (const platform of ["linux", "darwin", "win32"] as const) {
    it(`uses the shared file format on ${platform}`, () => {
      expect(getCredentialStore(platform)).toBeInstanceOf(FileCredentialStore);
    });
  }
});

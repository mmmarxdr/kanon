import { describe, it, expect } from "vitest";

// These imports will fail until factory.ts is created (TDD red phase)
import { getCredentialStore } from "./factory.js";
import { FileCredentialStore } from "./file-store.js";

describe("getCredentialStore", () => {
  it("returns a FileCredentialStore instance on linux", () => {
    expect(getCredentialStore("linux")).toBeInstanceOf(FileCredentialStore);
  });

  it("returns a FileCredentialStore instance on darwin", () => {
    expect(getCredentialStore("darwin")).toBeInstanceOf(FileCredentialStore);
  });

  it("returns a FileCredentialStore instance on win32", () => {
    expect(getCredentialStore("win32")).toBeInstanceOf(FileCredentialStore);
  });
});

import { describe, it, expect, afterEach } from "vitest";

// These imports will fail until factory.ts is created (TDD red phase)
import { getCredentialStore } from "./factory.js";
import { FileCredentialStore } from "./file-store.js";

function stubPlatform(value: string): () => void {
  const original = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", {
    value,
    writable: true,
    configurable: true,
  });
  return () => {
    if (original) {
      Object.defineProperty(process, "platform", original);
    }
  };
}

describe("getCredentialStore", () => {
  let restore: (() => void) | undefined;

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it("returns a FileCredentialStore instance on linux", () => {
    restore = stubPlatform("linux");
    const store = getCredentialStore();
    expect(store).toBeInstanceOf(FileCredentialStore);
  });

  it("throws a descriptive error on darwin (macOS)", () => {
    restore = stubPlatform("darwin");
    expect(() => getCredentialStore()).toThrow(
      /Credential store adapter not yet available for darwin/
    );
  });

  it("throws a descriptive error on win32 (Windows)", () => {
    restore = stubPlatform("win32");
    expect(() => getCredentialStore()).toThrow(
      /Credential store adapter not yet available for win32/
    );
  });
});

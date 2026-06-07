import { FileCredentialStore } from "./file-store.js";
import type { CredentialStore } from "./types.js";

/**
 * Returns the appropriate CredentialStore for the current platform.
 * Copied from packages/setup — self-contained runtime copy.
 */
export function getCredentialStore(): CredentialStore {
  const platform = process.platform;

  if (platform === "linux") {
    return new FileCredentialStore();
  }

  throw new Error(
    `Credential store adapter not yet available for ${platform}. See roadmap.`
  );
}

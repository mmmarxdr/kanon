import { FileCredentialStore } from "./file-store.js";
import type { CredentialStore } from "./types.js";

/**
 * Returns the appropriate CredentialStore for the current platform.
 *
 * Linux/WSL and macOS use POSIX modes; Windows adds a current-user ACL.
 */
export function getCredentialStore(
  platform: NodeJS.Platform = process.platform,
): CredentialStore {
  if (platform === "linux" || platform === "darwin" || platform === "win32") {
    return new FileCredentialStore();
  }

  throw new Error(
    `Credential store adapter not yet available for ${platform}. See roadmap.`
  );
}

import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import * as os from "os";
import type { CredentialStore, Creds } from "./types.js";

/**
 * FileCredentialStore — Linux/WSL2 credential adapter.
 *
 * Stores credentials as a JSON object keyed by server URL at
 * `~/.kanon/credentials` (or a custom homeDir for testing).
 *
 * Security:
 *   - ~/.kanon/ directory: mode 0700
 *   - credentials file: mode 0600
 *   - Atomic writes via temp-file + rename
 */
export class FileCredentialStore implements CredentialStore {
  private readonly homeDir: string;

  constructor(homeDir: string = os.homedir()) {
    this.homeDir = homeDir;
  }

  private get kanoDir(): string {
    return path.join(this.homeDir, ".kanon");
  }

  private get credFile(): string {
    return path.join(this.kanoDir, "credentials");
  }

  async readCredentials(server: string): Promise<Creds | null> {
    let raw: string;
    try {
      raw = await fs.readFile(this.credFile, "utf8");
    } catch {
      // File does not exist or is unreadable
      return null;
    }

    try {
      const data = JSON.parse(raw) as Record<string, unknown>;
      const entry = data[server];
      if (!entry || typeof entry !== "object") return null;
      return entry as Creds;
    } catch {
      // Malformed JSON — return null, do NOT throw
      return null;
    }
  }

  async writeCredentials(server: string, creds: Creds): Promise<void> {
    // Ensure ~/.kanon/ directory exists with mode 0700
    try {
      await fs.mkdir(this.kanoDir, { recursive: true, mode: 0o700 });
    } catch {
      // Directory may already exist; ignore
    }

    // Build the full credentials object (single-record file: overwrite)
    const data: Record<string, Creds> = { [server]: creds };
    const json = JSON.stringify(data, null, 2);

    // Atomic write: write to a temp file then rename
    const tmpFile = this.credFile + ".tmp";
    await fs.writeFile(tmpFile, json, { encoding: "utf8", mode: 0o600 });

    try {
      await fs.rename(tmpFile, this.credFile);
    } catch {
      // If rename fails (cross-device), fall back to copy+delete
      await fs.copyFile(tmpFile, this.credFile);
      await fs.chmod(this.credFile, 0o600);
      await fs.unlink(tmpFile).catch(() => undefined);
    }

    // Ensure correct perms on final file (handles case where file pre-existed)
    await fs.chmod(this.credFile, 0o600);
  }

  async clearCredentials(_server: string): Promise<void> {
    try {
      await fs.unlink(this.credFile);
    } catch {
      // File does not exist — idempotent no-op
    }
  }
}

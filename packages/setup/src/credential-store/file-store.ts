import * as fs from "fs/promises";
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

  private async readAll(): Promise<Record<string, Creds>> {
    let raw: string;
    try {
      raw = await fs.readFile(this.credFile, "utf8");
    } catch {
      return {};
    }
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const out: Record<string, Creds> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (v && typeof v === "object") out[k] = v as Creds;
      }
      return out;
    } catch {
      return {};
    }
  }

  private async writeAll(data: Record<string, Creds>): Promise<void> {
    try {
      await fs.mkdir(this.kanoDir, { recursive: true, mode: 0o700 });
    } catch {
      // already exists
    }

    const json = JSON.stringify(data, null, 2);
    const tmpFile = this.credFile + ".tmp";
    await fs.writeFile(tmpFile, json, { encoding: "utf8", mode: 0o600 });

    try {
      await fs.rename(tmpFile, this.credFile);
    } catch {
      await fs.copyFile(tmpFile, this.credFile);
      await fs.chmod(this.credFile, 0o600);
      await fs.unlink(tmpFile).catch(() => undefined);
    }

    await fs.chmod(this.credFile, 0o600);
  }

  async readCredentials(server: string): Promise<Creds | null> {
    const data = await this.readAll();
    return data[server] ?? null;
  }

  async writeCredentials(server: string, creds: Creds): Promise<void> {
    const data = await this.readAll();
    data[server] = creds;
    await this.writeAll(data);
  }

  async listServers(): Promise<string[]> {
    const data = await this.readAll();
    return Object.keys(data);
  }

  async clearCredentials(server: string): Promise<void> {
    const data = await this.readAll();
    if (!(server in data)) return;
    delete data[server];

    if (Object.keys(data).length === 0) {
      try {
        await fs.unlink(this.credFile);
      } catch {
        // idempotent
      }
      return;
    }

    await this.writeAll(data);
  }
}

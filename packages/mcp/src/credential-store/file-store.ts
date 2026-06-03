import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import type { CredentialStore, Creds } from "./types.js";
import { canonicalizeApiUrl } from "../canonical-url.js";

/**
 * FileCredentialStore — Linux/WSL2 credential adapter.
 * Copied from @kanon-pm/setup — both packages are independently shipped
 * npm packages that share the same credential file format but must be
 * self-contained at runtime.
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
    return data[canonicalizeApiUrl(server)] ?? null;
  }

  async writeCredentials(server: string, creds: Creds): Promise<void> {
    const data = await this.readAll();
    data[canonicalizeApiUrl(server)] = creds;
    await this.writeAll(data);
  }

  async clearCredentials(server: string): Promise<void> {
    const key = canonicalizeApiUrl(server);
    const data = await this.readAll();
    if (!(key in data)) return;
    delete data[key];

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

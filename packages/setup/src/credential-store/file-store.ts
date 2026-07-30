import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import type { CredentialStore, Creds } from "./types.js";
import { canonicalizeApiUrl } from "../canonical-url.js";

const execFileAsync = promisify(execFile);

export interface FileCredentialStoreOptions {
  platform?: NodeJS.Platform;
  powerShellPath?: string;
  runCommand?: (command: string, args: string[]) => Promise<void>;
  renameFile?: (from: string, to: string) => Promise<void>;
}

/**
 * FileCredentialStore — cross-platform credential adapter.
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
  private readonly platform: NodeJS.Platform;
  private readonly powerShellPath: string;
  private readonly runCommand: (
    command: string,
    args: string[],
  ) => Promise<void>;
  private readonly renameFile: (from: string, to: string) => Promise<void>;

  constructor(
    homeDir: string = os.homedir(),
    options: FileCredentialStoreOptions = {},
  ) {
    this.homeDir = homeDir;
    this.platform = options.platform ?? process.platform;
    this.powerShellPath = options.powerShellPath ?? path.win32.join(
      process.env["SystemRoot"] ?? process.env["WINDIR"] ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    this.runCommand =
      options.runCommand ??
      (async (command, args) => {
        await execFileAsync(command, args);
      });
    this.renameFile = options.renameFile ?? fs.rename;
  }

  private get kanoDir(): string {
    return path.join(this.homeDir, ".kanon");
  }

  private get credFile(): string {
    return path.join(this.kanoDir, "credentials");
  }

  private async secureWindowsPath(
    target: string,
    directory: boolean,
  ): Promise<void> {
    if (this.platform !== "win32") return;
    const targetBase64 = Buffer.from(target, "utf8").toString("base64");
    const securityClass = directory ? "DirectorySecurity" : "FileSecurity";
    const inheritance = directory
      ? "[System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit"
      : "[System.Security.AccessControl.InheritanceFlags]::None";
    const script = [
      "$ErrorActionPreference='Stop'",
      `$target=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${targetBase64}'))`,
      "$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User",
      `$acl=[System.Security.AccessControl.${securityClass}]::new()`,
      "$acl.SetOwner($sid)",
      "$acl.SetAccessRuleProtection($true,$false)",
      `$rule=[System.Security.AccessControl.FileSystemAccessRule]::new($sid,[System.Security.AccessControl.FileSystemRights]::FullControl,${inheritance},[System.Security.AccessControl.PropagationFlags]::None,[System.Security.AccessControl.AccessControlType]::Allow)`,
      "$acl.AddAccessRule($rule)",
      "Set-Acl -LiteralPath $target -AclObject $acl",
    ].join(";");
    try {
      await this.runCommand(this.powerShellPath, [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ]);
    } catch (err) {
      throw new Error(
        `Failed to secure ${target}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
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
    if (this.platform === "win32") {
      await this.secureWindowsPath(this.kanoDir, true);
    } else {
      await fs.chmod(this.kanoDir, 0o700);
    }

    const json = JSON.stringify(data, null, 2);
    const tmpFile = `${this.credFile}.${randomUUID()}.tmp`;
    let committed = false;
    try {
      await fs.writeFile(tmpFile, json, { encoding: "utf8", mode: 0o600 });
      if (this.platform === "win32") {
        await this.secureWindowsPath(tmpFile, false);
      } else {
        await fs.chmod(tmpFile, 0o600);
      }
      await this.renameFile(tmpFile, this.credFile);
      committed = true;
    } finally {
      if (!committed) await fs.unlink(tmpFile).catch(() => undefined);
    }
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

  async listServers(): Promise<string[]> {
    const data = await this.readAll();
    return Object.keys(data);
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

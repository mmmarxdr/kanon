// ─── Detection Utilities ─────────────────────────────────────────────────────

import fs from "node:fs";
import { execSync } from "node:child_process";

/**
 * Check if running inside WSL by reading /proc/version.
 */
export function isWsl(): boolean {
  try {
    const version = fs.readFileSync("/proc/version", "utf8");
    return /microsoft/i.test(version);
  } catch {
    return false;
  }
}

/**
 * Resolve Windows home directory from within WSL.
 * Uses cmd.exe to get %USERNAME% and constructs /mnt/c/Users/<user>.
 */
export function resolveWinHome(): string | undefined {
  try {
    const username = execSync('cmd.exe /c "echo %USERNAME%"', {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).replace(/[\r\n]+/g, "");

    if (!username) return undefined;

    const winHome = `/mnt/c/Users/${username}`;
    if (fs.existsSync(winHome)) {
      return winHome;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Check if a command exists on the system.
 */
export function commandExists(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: ["pipe", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

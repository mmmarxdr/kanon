// ─── Detection Utilities ─────────────────────────────────────────────────────

import fs from "node:fs";
import os from "node:os";
import { execSync } from "node:child_process";
import type { Platform, PlatformContext } from "./types.js";

// ─── Internal Helpers ────────────────────────────────────────────────────────

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

// ─── Platform Detection ──────────────────────────────────────────────────────

/**
 * Detect the current platform as a tri-state: win32, wsl, or linux.
 * Accepts an optional override for testing.
 */
export function detectPlatform(override?: Platform): Platform {
  if (override) return override;

  if (process.platform === "win32") return "win32";
  if (isWsl()) return "wsl";
  return "linux";
}

/**
 * Build a PlatformContext once at startup. All downstream functions receive
 * this context instead of threading winHome/wslMode booleans.
 *
 * Overrides allow test injection without mocking globals.
 */
export async function buildPlatformContext(
  overrides?: Partial<PlatformContext>,
): Promise<PlatformContext> {
  const platform = overrides?.platform ?? detectPlatform();
  const homedir = overrides?.homedir ?? os.homedir();

  const ctx: PlatformContext = { platform, homedir };

  switch (platform) {
    case "win32":
      ctx.appDataDir = overrides?.appDataDir ?? process.env["APPDATA"];
      break;
    case "wsl":
      ctx.winHome = overrides?.winHome ?? resolveWinHome();
      break;
    case "linux":
      // No extra fields needed
      break;
  }

  return ctx;
}

// ─── Command Existence ───────────────────────────────────────────────────────

/**
 * Check if a command exists on the system.
 * Uses `where` on win32 and `which` on linux/wsl.
 */
export function commandExists(cmd: string, platform?: Platform): boolean {
  const whichCmd = platform === "win32" ? "where" : "which";
  try {
    execSync(`${whichCmd} ${cmd}`, { stdio: ["pipe", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

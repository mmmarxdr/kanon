import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { execSync } from "node:child_process";

// Mock modules before importing the module under test
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    default: {
      ...actual,
      readFileSync: vi.fn(actual.readFileSync),
      existsSync: vi.fn(actual.existsSync),
    },
  };
});

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    execSync: vi.fn(actual.execSync),
  };
});

// Import after mocking
const { isWsl, detectPlatform, buildPlatformContext, commandExists } = await import("../detect.js");

const mockedFs = vi.mocked(fs);
const mockedExecSync = vi.mocked(execSync);

describe("detect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isWsl", () => {
    it("should return true when /proc/version contains 'microsoft'", () => {
      mockedFs.readFileSync.mockReturnValue(
        "Linux version 5.15.167.4-microsoft-standard-WSL2 (root@1234) (gcc 12)"
      );

      expect(isWsl()).toBe(true);
    });

    it("should return false when /proc/version does not contain 'microsoft'", () => {
      mockedFs.readFileSync.mockReturnValue(
        "Linux version 6.1.0-18-amd64 (debian-kernel@lists.debian.org)"
      );

      expect(isWsl()).toBe(false);
    });

    it("should return false when /proc/version does not exist (macOS, etc.)", () => {
      mockedFs.readFileSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });

      expect(isWsl()).toBe(false);
    });
  });

  describe("detectPlatform", () => {
    it("should return the override when provided", () => {
      expect(detectPlatform("win32")).toBe("win32");
      expect(detectPlatform("wsl")).toBe("wsl");
      expect(detectPlatform("linux")).toBe("linux");
    });

    it("should detect wsl when /proc/version contains microsoft", () => {
      // Simulate non-win32 process.platform (this test runs on Linux/WSL)
      mockedFs.readFileSync.mockReturnValue(
        "Linux version 5.15.167.4-microsoft-standard-WSL2"
      );

      // Without override, on a non-win32 platform, it should check isWsl()
      const result = detectPlatform();
      // On this WSL2 machine, the real /proc/version has "microsoft"
      // but we mocked readFileSync, so it depends on the mock
      expect(result).toBe("wsl");
    });

    it("should detect linux when /proc/version has no microsoft", () => {
      mockedFs.readFileSync.mockReturnValue(
        "Linux version 6.1.0-18-amd64 (debian-kernel@lists.debian.org)"
      );

      const result = detectPlatform();
      expect(result).toBe("linux");
    });
  });

  describe("buildPlatformContext", () => {
    it("should build wsl context with winHome override", async () => {
      const ctx = await buildPlatformContext({
        platform: "wsl",
        homedir: "/home/testuser",
        winHome: "/mnt/c/Users/TestUser",
      });

      expect(ctx.platform).toBe("wsl");
      expect(ctx.homedir).toBe("/home/testuser");
      expect(ctx.winHome).toBe("/mnt/c/Users/TestUser");
      expect(ctx.appDataDir).toBeUndefined();
    });

    it("should build win32 context with appDataDir override", async () => {
      const ctx = await buildPlatformContext({
        platform: "win32",
        homedir: "C:\\Users\\TestUser",
        appDataDir: "C:\\Users\\TestUser\\AppData\\Roaming",
      });

      expect(ctx.platform).toBe("win32");
      expect(ctx.homedir).toBe("C:\\Users\\TestUser");
      expect(ctx.appDataDir).toBe("C:\\Users\\TestUser\\AppData\\Roaming");
      expect(ctx.winHome).toBeUndefined();
    });

    it("should build linux context with no extra fields", async () => {
      const ctx = await buildPlatformContext({
        platform: "linux",
        homedir: "/home/testuser",
      });

      expect(ctx.platform).toBe("linux");
      expect(ctx.homedir).toBe("/home/testuser");
      expect(ctx.winHome).toBeUndefined();
      expect(ctx.appDataDir).toBeUndefined();
    });

    it("should use os.homedir() when homedir not overridden", async () => {
      const ctx = await buildPlatformContext({
        platform: "linux",
      });

      expect(ctx.platform).toBe("linux");
      // homedir should be a non-empty string from os.homedir()
      expect(typeof ctx.homedir).toBe("string");
      expect(ctx.homedir.length).toBeGreaterThan(0);
    });
  });

  describe("commandExists", () => {
    it("should return true when the command exists", () => {
      mockedExecSync.mockReturnValue(Buffer.from("/usr/bin/node"));

      expect(commandExists("node")).toBe(true);
      expect(mockedExecSync).toHaveBeenCalledWith("which node", {
        stdio: ["pipe", "pipe", "pipe"],
      });
    });

    it("should return false when the command does not exist", () => {
      mockedExecSync.mockImplementation(() => {
        throw new Error("not found");
      });

      expect(commandExists("nonexistent-cmd-xyz")).toBe(false);
    });

    it("should use 'where' on win32 platform", () => {
      mockedExecSync.mockReturnValue(Buffer.from("C:\\Program Files\\nodejs\\node.exe"));

      expect(commandExists("node", "win32")).toBe(true);
      expect(mockedExecSync).toHaveBeenCalledWith("where node", {
        stdio: ["pipe", "pipe", "pipe"],
      });
    });

    it("should use 'which' on wsl platform", () => {
      mockedExecSync.mockReturnValue(Buffer.from("/usr/bin/node"));

      expect(commandExists("node", "wsl")).toBe(true);
      expect(mockedExecSync).toHaveBeenCalledWith("which node", {
        stdio: ["pipe", "pipe", "pipe"],
      });
    });

    it("should use 'which' on linux platform", () => {
      mockedExecSync.mockReturnValue(Buffer.from("/usr/bin/node"));

      expect(commandExists("node", "linux")).toBe(true);
      expect(mockedExecSync).toHaveBeenCalledWith("which node", {
        stdio: ["pipe", "pipe", "pipe"],
      });
    });
  });
});

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
const { isWsl, commandExists } = await import("../detect.js");

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
  });
});

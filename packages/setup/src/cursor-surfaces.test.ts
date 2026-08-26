import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { PlatformContext } from "./types.js";
import {
  discoverCursorSurfaces,
  probeCursorExecutable,
  resolveCursorAuthorization,
} from "./cursor-surfaces.js";

const linux: PlatformContext = { platform: "linux", homedir: "/home/me" };

describe("Cursor surface discovery", () => {
  it("deduplicates CLI aliases and keeps the IDE independent", () => {
    const spawnSync = vi.fn((file: string) => ({
      status: 0,
      stdout: file === "cursor" ? "0.48.0\n" : "0.48.0\n",
      stderr: "",
    }));
    const surfaces = discoverCursorSurfaces(linux, {
      existsSync: (candidate) => candidate === path.join("/home/me", ".cursor"),
      resolveCommand: (command) => command === "cursor" || command === "agent"
        ? "/opt/Cursor CLI/cursor"
        : undefined,
      spawnSync,
    });

    expect(surfaces).toEqual([
      expect.objectContaining({ surface: "ide", state: "configured-only/stale", host: "local" }),
      expect.objectContaining({
        surface: "cli",
        state: "executable-valid",
        executable: expect.objectContaining({ path: "/opt/Cursor CLI/cursor", version: "0.48.0" }),
      }),
    ]);
    expect(spawnSync).toHaveBeenCalledTimes(1);
  });

  it("continues through distinct aliases after a stale first probe", () => {
    const spawnSync = vi.fn((file: string) => file === "/bin/cursor"
      ? { status: 1, stdout: "", stderr: "missing" }
      : { status: 0, stdout: "0.49.0\n", stderr: "" });
    const surfaces = discoverCursorSurfaces(linux, {
      resolveCommand: (command) => command === "cursor" ? "/bin/cursor"
        : command === "agent" ? "/opt/cursor-agent" : undefined,
      spawnSync,
    });

    expect(surfaces).toContainEqual(expect.objectContaining({
      surface: "cli", state: "executable-valid",
      executable: expect.objectContaining({ path: "/opt/cursor-agent", version: "0.49.0" }),
    }));
    expect(spawnSync).toHaveBeenCalledTimes(2);
  });

  it("treats a config directory without an IDE executable as stale evidence", () => {
    const surfaces = discoverCursorSurfaces(linux, {
      existsSync: (candidate) => candidate === path.join("/home/me", ".cursor"),
      resolveCommand: () => undefined,
    });
    expect(surfaces).toContainEqual(expect.objectContaining({
      surface: "ide", state: "configured-only/stale",
    }));
  });

  it("makes stale aliases and ambiguous WSL distros non-valid evidence", () => {
    const wsl: PlatformContext = { platform: "wsl", homedir: "/home/me", winHome: "/mnt/c/Users/me" };
    const surfaces = discoverCursorSurfaces(wsl, {
      existsSync: (candidate) => candidate === path.join("/mnt/c/Users/me", ".cursor"),
      resolveCommand: (command) => command === "cursor" ? "/usr/bin/cursor" : undefined,
      spawnSync: () => ({ status: 1, stdout: "", stderr: "stale" }),
      listWslDistributions: () => ["Ubuntu", "Debian"],
    });

    expect(surfaces).toEqual(expect.arrayContaining([
      expect.objectContaining({ surface: "cli", state: "configured-only/stale" }),
      expect.objectContaining({ surface: "ide", host: "windows", state: "ambiguous" }),
    ]));
  });

  it("treats UNC Cursor.exe aliases as static non-launching evidence", () => {
    const spawnSync = vi.fn(() => ({ status: 0, stdout: "1.0.0\n", stderr: "" }));
    const evidence = probeCursorExecutable("\\\\server\\share\\Cursor App\\cursor.exe", { spawnSync });

    expect(evidence).toEqual(expect.objectContaining({
      state: "executable-valid", executable: expect.objectContaining({ version: "unprobed" }),
    }));
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it("requires explicit or prompt authorization for a validated Windows bridge", () => {
    const bridge = { distribution: "Ubuntu-24.04" };
    expect(resolveCursorAuthorization({ tool: "cursor" }, false, bridge)).toEqual({
      source: "explicit", crossHost: "authorized", bridge,
    });
    expect(resolveCursorAuthorization({ all: true }, false, bridge)).toEqual({
      source: "all", crossHost: "denied", bridge,
    });
    expect(resolveCursorAuthorization({}, true, bridge)).toEqual({
      source: "autodetect", crossHost: "denied", bridge,
    });
  });
});

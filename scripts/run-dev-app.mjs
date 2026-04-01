/**
 * Start API + Web only (no docker postgres, engram, or mcp build).
 * Requires DATABASE_URL reachable (e.g. Postgres already running).
 * Ctrl+C kills both children.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const children = [];

function spawnFiltered(name, args) {
  const child = spawn("pnpm", args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env },
  });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else if (code && code !== 0) process.exit(code);
  });
  children.push({ name, child });
}

spawnFiltered("api", ["--filter", "@kanon/api", "dev"]);
spawnFiltered("web", ["--filter", "@kanon/web", "dev"]);

function shutdown() {
  for (const { child } of children) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

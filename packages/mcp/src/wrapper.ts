/**
 * kanon-mcp-wrapper — thin Node.js wrapper binary.
 *
 * Before speaking MCP protocol:
 *   1. If KANON_API_KEY is already set → legacy bypass: spawn MCP server directly.
 *   2. Read refresh token from credential store (keyed by --server <url>).
 *   3. POST <server>/api/auth/exchange { refreshToken } → receive accessToken.
 *   4. Spawn real MCP server with KANON_API_KEY=<accessToken> injected.
 *   5. Forward SIGINT/SIGTERM to child; exit with child's exit code.
 *
 * All side effects are injectable via WrapperDeps for testability.
 */

import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from "child_process";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import { getCredentialStore as defaultGetCredentialStore } from "./credential-store/index.js";
import type { CredentialStore } from "./credential-store/types.js";

// ─── Injectable deps interface ─────────────────────────────────────────────

export interface WrapperDeps {
  argv: string[];
  env: Record<string, string | undefined>;
  fetch: typeof globalThis.fetch;
  getCredentialStore: () => CredentialStore;
  stderr: { write: (s: string) => void };
  exit: (code: number) => void;
  spawn: (cmd: string, args: string[], opts: SpawnOptions) => ChildProcess;
}

// ─── Arg parsing ───────────────────────────────────────────────────────────

function parseServerArg(argv: string[]): string | undefined {
  const idx = argv.indexOf("--server");
  if (idx !== -1 && argv[idx + 1]) return argv[idx + 1];
  const flag = argv.find((a) => a.startsWith("--server="));
  if (flag) return flag.slice("--server=".length);
  return undefined;
}

// ─── Real MCP server path ──────────────────────────────────────────────────

function getMcpServerPath(): string {
  // In dist/ both wrapper.js and index.js live side by side.
  const __dirname = dirname(fileURLToPath(import.meta.url));
  return join(__dirname, "index.js");
}

// ─── Core logic ────────────────────────────────────────────────────────────

export async function runWrapper(deps?: Partial<WrapperDeps>): Promise<void> {
  const argv = deps?.argv ?? process.argv;
  const env = deps?.env ?? (process.env as Record<string, string | undefined>);
  const fetchFn = deps?.fetch ?? globalThis.fetch;
  const getCredentialStore = deps?.getCredentialStore ?? defaultGetCredentialStore;
  const stderr = deps?.stderr ?? { write: (s: string) => { process.stderr.write(s); } };
  const exit = deps?.exit ?? process.exit;
  const spawnFn = deps?.spawn ?? nodeSpawn;

  const server = parseServerArg(argv);

  // ── S4.3: Legacy bypass ──────────────────────────────────────────────────
  if (env["KANON_API_KEY"]) {
    await spawnMcpServer(
      spawnFn,
      {
        ...env,
        KANON_API_KEY: env["KANON_API_KEY"],
        ...(server ? { KANON_API_URL: server } : {}),
      },
      exit
    );
    return;
  }

  // ── Require --server when not in legacy bypass mode ──────────────────────
  if (!server) {
    stderr.write(
      "Error: --server <url> is required. Run: npx @kanon-pm/setup <kanon://link>\n"
    );
    exit(1);
    return;
  }

  // ── S4.5: Read credentials ───────────────────────────────────────────────
  const store = getCredentialStore();
  let creds: Awaited<ReturnType<CredentialStore["readCredentials"]>>;
  try {
    creds = await store.readCredentials(server);
  } catch {
    creds = null;
  }

  if (!creds) {
    stderr.write(
      `No credentials found. Run: npx @kanon-pm/setup <kanon://link>\n`
    );
    exit(1);
    return;
  }

  // ── S4.1 / S4.2 / S4.4: Exchange refresh token ──────────────────────────
  let accessToken: string;
  try {
    const res = await fetchFn(`${server}/api/auth/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: creds.refreshToken }),
    });

    if (!res.ok) {
      // S4.2 — non-2xx (expired / revoked)
      stderr.write(
        `Refresh expired or revoked. Run: npx @kanon-pm/setup login\n`
      );
      exit(1);
      return;
    }

    const data = (await res.json()) as { accessToken: string; expiresIn: number };
    accessToken = data.accessToken;
  } catch {
    // S4.4 — network failure
    const host = new URL(server).hostname;
    stderr.write(
      `Could not reach ${host}. Run: npx @kanon-pm/setup login\n`
    );
    exit(1);
    return;
  }

  // ── S4.1: Spawn MCP server ───────────────────────────────────────────────
  await spawnMcpServer(
    spawnFn,
    {
      ...env,
      KANON_API_KEY: accessToken,
      KANON_API_URL: server,
    },
    exit
  );
}

// ─── Spawn helper ─────────────────────────────────────────────────────────

function spawnMcpServer(
  spawnFn: (cmd: string, args: string[], opts: SpawnOptions) => ChildProcess,
  childEnv: Record<string, string | undefined>,
  exit: (code: number) => void
): Promise<void> {
  return new Promise((resolve) => {
    const mcpPath = getMcpServerPath();
    const child = spawnFn(process.execPath, [mcpPath], {
      env: childEnv as NodeJS.ProcessEnv,
      stdio: "inherit",
    });

    // Forward signals to child
    const forwardSIGINT = () => child.kill("SIGINT");
    const forwardSIGTERM = () => child.kill("SIGTERM");
    process.on("SIGINT", forwardSIGINT);
    process.on("SIGTERM", forwardSIGTERM);

    child.on("exit", (code) => {
      process.off("SIGINT", forwardSIGINT);
      process.off("SIGTERM", forwardSIGTERM);
      exit(code ?? 1);
      resolve();
    });
  });
}

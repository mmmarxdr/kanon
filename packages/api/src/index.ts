import fs from "node:fs";
import path from "node:path";
import { env } from "./config/env.js";
import { buildApp } from "./app.js";
import { disconnectPrisma } from "./config/prisma.js";

const DEV_INFO_DIR = path.resolve(process.cwd(), ".dev-info");
const DEV_INFO_FILE = path.join(DEV_INFO_DIR, "api.json");
const DEV_INFO_TMP = path.join(DEV_INFO_DIR, "api.json.tmp");

function writeDevInfo(port: number, host: string): void {
  try {
    fs.mkdirSync(DEV_INFO_DIR, { recursive: true });
    const info = {
      service: "api",
      port,
      host,
      url: `http://${host === "0.0.0.0" ? "localhost" : host}:${port}`,
      pid: process.pid,
      startedAt: new Date().toISOString(),
    };
    fs.writeFileSync(DEV_INFO_TMP, JSON.stringify(info, null, 2));
    fs.renameSync(DEV_INFO_TMP, DEV_INFO_FILE);
  } catch {
    // Non-fatal — dev-info is best-effort
  }
}

function removeDevInfo(): void {
  try {
    fs.unlinkSync(DEV_INFO_FILE);
  } catch {
    // Already gone or never written — ignore
  }
}

async function main(): Promise<void> {
  const app = await buildApp();

  // Graceful shutdown
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  for (const signal of signals) {
    process.on(signal, async () => {
      app.log.info(`Received ${signal}, shutting down gracefully...`);
      removeDevInfo();
      await app.close();
      await disconnectPrisma();
      process.exit(0);
    });
  }

  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    app.log.info(`Server running on http://0.0.0.0:${env.PORT}`);

    // Write actual bound address — source of port truth
    const addr = app.server.address();
    if (typeof addr === "object" && addr !== null) {
      writeDevInfo(addr.port, addr.address);
    }
  } catch (err: unknown) {
    const isAddrinuse =
      typeof err === "object" &&
      err !== null &&
      (err as NodeJS.ErrnoException).code === "EADDRINUSE";

    if (isAddrinuse) {
      console.error(
        `\n[error] Port ${env.PORT} is in use.\n` +
          `        Override with KANON_API_PORT=<n> pnpm dev:start\n`
      );
    } else {
      app.log.error(err, "Failed to start server");
    }
    await disconnectPrisma();
    process.exit(1);
  }
}

main();

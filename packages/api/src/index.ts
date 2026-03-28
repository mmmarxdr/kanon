import { env } from "./config/env.js";
import { buildApp } from "./app.js";
import { disconnectPrisma } from "./config/prisma.js";

async function main(): Promise<void> {
  const app = await buildApp();

  // Graceful shutdown
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  for (const signal of signals) {
    process.on(signal, async () => {
      app.log.info(`Received ${signal}, shutting down gracefully...`);
      await app.close();
      await disconnectPrisma();
      process.exit(0);
    });
  }

  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    app.log.info(`Server running on http://0.0.0.0:${env.PORT}`);
  } catch (err) {
    app.log.error(err, "Failed to start server");
    await disconnectPrisma();
    process.exit(1);
  }
}

main();

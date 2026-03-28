import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { env } from "./config/env.js";
import errorHandler from "./plugins/error-handler.js";
import authPlugin from "./plugins/auth.js";
import csrfPlugin from "./plugins/csrf.js";
import authRoutes from "./modules/auth/routes.js";
import activityRoutes from "./modules/activity/routes.js";
import workspaceRoutes from "./modules/workspace/routes.js";
import projectRoutes from "./modules/project/routes.js";
import issueRoutes from "./modules/issue/routes.js";
import commentRoutes from "./modules/comment/routes.js";
import eventsRoutes from "./modules/events/routes.js";
import memberRoutes from "./modules/member/routes.js";
import roadmapRoutes from "./modules/roadmap/routes.js";
import { EngramClient } from "@kanon/bridge";
import { BridgeSyncService } from "./services/bridge-sync-service.js";

/**
 * Build and configure the Fastify application.
 * Registers all plugins and module routes.
 */
export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env["NODE_ENV"] === "production" ? "info" : "debug",
      transport:
        process.env["NODE_ENV"] !== "production"
          ? { target: "pino-pretty" }
          : undefined,
    },
  });

  // Zod type provider for request/response validation
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // CORS — must be registered before all other plugins
  await app.register(cors, {
    origin: env.CORS_ORIGIN ?? ["http://localhost:5173"],
    credentials: true,
  });

  // Core plugins
  await app.register(cookie, {
    secret: env.COOKIE_SECRET || undefined,
  });
  await app.register(errorHandler);
  await app.register(authPlugin);
  await app.register(csrfPlugin);

  // Health check (always public, before auth)
  app.get("/health", async () => ({ status: "ok" }));

  // Feature module routes
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(workspaceRoutes, { prefix: "/api/workspaces" });
  await app.register(projectRoutes, { prefix: "/api" });
  await app.register(issueRoutes, { prefix: "/api" });
  await app.register(commentRoutes, { prefix: "/api" });
  await app.register(activityRoutes, { prefix: "/api" });
  await app.register(eventsRoutes, { prefix: "/api/events" });
  await app.register(memberRoutes, { prefix: "/api/members" });
  await app.register(roadmapRoutes, { prefix: "/api" });

  // ─── Bridge Sync Service (Phase C) ───────────────────────────────────
  if (env.ENGRAM_SYNC_ENABLED) {
    const engramClient = new EngramClient({
      baseUrl: env.ENGRAM_URL,
      apiKey: env.ENGRAM_API_KEY,
    });

    const bridgeSyncService = new BridgeSyncService(engramClient, {
      pollIntervalMs: env.ENGRAM_POLL_INTERVAL_MS,
    });

    // Decorate so routes/plugins can access the service
    app.decorate("bridgeSyncService", bridgeSyncService);

    // Start polling after server is ready
    app.addHook("onReady", async () => {
      bridgeSyncService.start();
      app.log.info(
        { pollIntervalMs: env.ENGRAM_POLL_INTERVAL_MS },
        "BridgeSyncService started",
      );
    });

    // Stop on server close
    app.addHook("onClose", async () => {
      bridgeSyncService.stop();
      app.log.info("BridgeSyncService stopped");
    });
  }

  return app;
}

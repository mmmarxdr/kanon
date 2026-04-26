import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { env } from "./config/env.js";
import { prisma } from "./config/prisma.js";
import errorHandler from "./plugins/error-handler.js";
import authPlugin from "./plugins/auth.js";
import csrfPlugin from "./plugins/csrf.js";
import authRoutes from "./modules/auth/routes.js";
import activityRoutes from "./modules/activity/routes.js";
import workspaceRoutes from "./modules/workspace/routes.js";
import dashboardRoutes from "./modules/dashboard/routes.js";
import {
  workspaceProposalRoutes,
  proposalActionRoutes,
} from "./modules/mcp-proposal/routes.js";
import projectRoutes from "./modules/project/routes.js";
import issueRoutes from "./modules/issue/routes.js";
import issueDependencyRoutes from "./modules/issue-dependency/routes.js";
import commentRoutes from "./modules/comment/routes.js";
import eventsRoutes from "./modules/events/routes.js";
import workspaceEventsRoutes from "./modules/events/workspace-events.js";
import memberRoutes from "./modules/member/routes.js";
import workspaceMemberRoutes from "./modules/member/workspace-member-routes.js";
import roadmapRoutes from "./modules/roadmap/routes.js";
import cycleRoutes from "./modules/cycle/routes.js";
import workSessionRoutes from "./modules/work-session/routes.js";
import { workspaceInviteRoutes, publicInviteRoutes } from "./modules/invite/routes.js";
import { EngramClient } from "@kanon/bridge";
import { BridgeSyncService } from "./services/bridge-sync-service.js";
import { eventBus } from "./services/event-bus/index.js";
import { cleanupExpired } from "./modules/work-session/service.js";

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

  // Rate limiting — registered globally with a generous default,
  // auth routes apply stricter per-route limits via routeConfig.
  // Disabled in test mode to avoid false failures in integration tests.
  if (env.NODE_ENV !== "test") {
    await app.register(rateLimit, {
      max: 1000,
      timeWindow: "1 minute",
    });
  }

  // Core plugins
  await app.register(cookie, {
    secret: env.COOKIE_SECRET || undefined,
  });
  await app.register(errorHandler);
  await app.register(authPlugin);
  await app.register(csrfPlugin);

  // ─── Domain EventBus ──────────────────────────────────────────────────
  app.decorate("eventBus", eventBus);

  // Health check with DB connectivity (always public, before auth)
  app.get("/health", async (_request, reply) => {
    try {
      await prisma.$queryRawUnsafe("SELECT 1");
      return { status: "ok", db: "connected" };
    } catch {
      return reply.status(503).send({ status: "degraded", db: "disconnected" });
    }
  });

  // Feature module routes
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(workspaceRoutes, { prefix: "/api/workspaces" });
  await app.register(dashboardRoutes, { prefix: "/api/workspaces" });
  await app.register(workspaceProposalRoutes, { prefix: "/api/workspaces" });
  await app.register(proposalActionRoutes, { prefix: "/api" });
  await app.register(projectRoutes, { prefix: "/api" });
  await app.register(issueRoutes, { prefix: "/api" });
  await app.register(issueDependencyRoutes, { prefix: "/api" });
  await app.register(commentRoutes, { prefix: "/api" });
  await app.register(activityRoutes, { prefix: "/api" });
  await app.register(eventsRoutes, { prefix: "/api/events" });
  await app.register(workspaceEventsRoutes, { prefix: "/api/events/workspace" });
  await app.register(memberRoutes, { prefix: "/api/members" });
  await app.register(workspaceMemberRoutes, { prefix: "/api/workspaces/:wid/members" });
  await app.register(roadmapRoutes, { prefix: "/api" });
  await app.register(cycleRoutes, { prefix: "/api" });
  await app.register(workSessionRoutes, { prefix: "/api" });
  await app.register(workspaceInviteRoutes, { prefix: "/api/workspaces/:wid/invites" });
  await app.register(publicInviteRoutes, { prefix: "/api/invites" });

  // ─── Work Session Cleanup (background interval) ──────────────────────
  let cleanupInterval: ReturnType<typeof setInterval> | undefined;

  app.addHook("onReady", async () => {
    cleanupInterval = setInterval(() => {
      cleanupExpired(app.log).catch((err) => {
        app.log.error({ err }, "Work session cleanup failed");
      });
    }, 60_000); // every 60 seconds
    app.log.info("Work session cleanup interval started (every 60s)");
  });

  app.addHook("onClose", async () => {
    if (cleanupInterval) {
      clearInterval(cleanupInterval);
      app.log.info("Work session cleanup interval stopped");
    }
  });

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

import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { env } from "./config/env.js";
import { prisma } from "./config/prisma.js";
import errorHandler from "./plugins/error-handler.js";
import authPlugin from "./plugins/auth.js";
import csrfPlugin from "./plugins/csrf.js";
import metricsPlugin from "./plugins/metrics.js";
import viaPlugin from "./plugins/via.js";
import authRoutes from "./modules/auth/routes.js";
import activityRoutes from "./modules/activity/routes.js";
import workspaceRoutes from "./modules/workspace/routes.js";
import dashboardRoutes from "./modules/dashboard/routes.js";
import { workspaceProposalRoutes, proposalActionRoutes } from "./modules/mcp-proposal/routes.js";
import projectRoutes from "./modules/project/routes.js";
import issueRoutes from "./modules/issue/routes.js";
import issueDependencyRoutes from "./modules/issue-dependency/routes.js";
import commentRoutes from "./modules/comment/routes.js";
import documentRoutes from "./modules/document/routes.js";
import workspaceEventsRoutes from "./modules/events/workspace-events.js";
import memberRoutes from "./modules/member/routes.js";
import workspaceMemberRoutes from "./modules/member/workspace-member-routes.js";
import roadmapRoutes from "./modules/roadmap/routes.js";
import cycleRoutes from "./modules/cycle/routes.js";
import workSessionRoutes from "./modules/work-session/routes.js";
import scheduleRoutes from "./modules/schedule/routes.js";
import timesheetRoutes from "./modules/timesheet/routes.js";
import milestoneRoutes from "./modules/milestone/routes.js";
import notificationRoutes, { notificationActionRoutes } from "./modules/notification/routes.js";
import issueSubscriptionRoutes from "./modules/issue-subscription/routes.js";
import { workspaceInviteRoutes, publicInviteRoutes } from "./modules/invite/routes.js";
import projectMemberRoutes from "./modules/project/project-member-routes.js";
import instanceRoutes from "./modules/instance/routes.js";
import { bootstrapSetupToken } from "./modules/instance/service.js";
import { eventBus } from "./services/event-bus/index.js";
import { cleanupExpired } from "./modules/work-session/service.js";
import { registerNotificationService } from "./services/notification/index.js";
import { createEmailProvider } from "./services/email/index.js";
import type { EmailProvider } from "./services/email/types.js";
import { registerForecastListener } from "./modules/forecast/index.js";
import { registerTransitionListener } from "./modules/work-session/transition-listener.js";
import { startIntegrationScheduler } from "./modules/integrations/scheduler.js";
import { registerIntegrationSyncListener } from "./modules/integrations/sync-listener.js";
import {
  createIntegrationWorkerCycle,
  readIntegrationWorkerStartupSnapshot,
} from "./modules/integrations/worker.js";
import integrationRoutes from "./modules/integrations/routes.js";

export interface BuildAppOptions {
  /** Optional override for the email provider (useful for testing with a spy). */
  emailProvider?: EmailProvider;
  /** Optional durable-work scanner override for lifecycle tests. */
  integrationScan?: () => Promise<unknown>;
  /**
   * Force-enable rate limiting even under NODE_ENV=test (KAN-77). Rate limiting
   * is normally off in test to avoid cross-test interference; integration tests
   * that assert the limiter's behavior opt in via this flag.
   */
  enableRateLimit?: boolean;
}

/**
 * Build and configure the Fastify application.
 * Registers all plugins and module routes.
 */
export async function buildApp(opts: BuildAppOptions = {}) {
  const app = Fastify({
    // KAN-77: trust the internal reverse-proxy hops (caddy/nginx, on the private
    // docker network) so `request.ip` resolves to the real client IP from
    // X-Forwarded-For instead of a proxy container IP. Without this, every
    // request shares one IP and the auth rate limits below would throttle all
    // users as a single bucket. Default (env.TRUST_PROXY=uniquelocal) is correct
    // for both the caddy→nginx→api and nginx→api topologies.
    trustProxy: env.TRUST_PROXY,
    logger: {
      level: process.env["NODE_ENV"] === "production" ? "info" : "debug",
      transport: process.env["NODE_ENV"] !== "production" ? { target: "pino-pretty" } : undefined,
      // Observability slice 1: redact secrets from structured log output so
      // they never reach log aggregators. Pino replaces matched paths with
      // "[Redacted]". Paths are pino-style dot-notation; Authorization and
      // cookie cover auth material; password covers login-request bodies.
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.body.password",
        "req.body.apiKey",
      ],
      // ^ceiling: extend redact list if new sensitive fields are added (e.g.
      // req.body.token, req.body.refreshToken).
      base: { service: "kanon-api" },
      formatters: {
        // Emit level as human-readable string ("info") not pino's integer (30).
        // Aligns with log aggregator expectations (CloudWatch, Datadog, Loki).
        level: (label: string) => ({ level: label }),
      },
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

  // Security headers (KAN-78). This API serves only JSON + SSE — the SPA is
  // served (and CSP'd) separately by nginx — so the Content-Security-Policy here
  // is locked all the way down. `useDefaults: false` is REQUIRED: with helmet's
  // default (true) the four directives below would be merged with helmet's
  // permissive defaults (script-src 'self', style-src … 'unsafe-inline', …).
  // With it false, only these four are emitted and every unspecified fetch
  // directive falls back to `default-src 'none'` per the CSP spec — the API
  // never returns renderable content, so nothing is allowed to load.
  // crossOriginResourcePolicy is "cross-origin" so the browser SPA can read API
  // responses across origins (dev: :5173 → :3000); CORS still governs access.
  // HSTS is left on (helmet default) as defense-in-depth — Caddy terminates TLS
  // but does not set Strict-Transport-Security itself.
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
  });

  // Rate limiting — registered globally with a generous default,
  // auth routes apply stricter per-route limits via routeConfig.
  // Disabled in test mode to avoid false failures in integration tests,
  // unless a test explicitly opts in via opts.enableRateLimit (KAN-77).
  if (env.NODE_ENV !== "test" || opts.enableRateLimit) {
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
  await app.register(viaPlugin);
  await app.register(csrfPlugin);
  // Observability slice 1: Prometheus metrics endpoint (GET /metrics).
  // Registered after csrf (which early-returns on GET, so no csrf conflict)
  // and before routes so all route metrics are captured.
  await app.register(metricsPlugin);

  // ─── Domain EventBus ──────────────────────────────────────────────────
  app.decorate("eventBus", eventBus);

  // Wire the Fastify logger into the event bus so subscriber errors are
  // routed through pino rather than console (which is only the pre-boot default).
  eventBus.setLogger(app.log);

  // ─── NotificationService ──────────────────────────────────────────────
  // Subscribe to the EventBus at startup; unsubscribe on close (D3).
  // S5: emailProvider injected here — ConsoleProvider in dev/test, ResendProvider in prod.
  // opts.emailProvider overrides the default (used in integration tests for spying).
  const unsubscribeNotifications = registerNotificationService(eventBus, {
    logger: app.log,
    emailProvider: opts.emailProvider ?? createEmailProvider(),
  });
  app.addHook("onClose", async () => {
    unsubscribeNotifications();
  });

  // ─── ForecastListener ─────────────────────────────────────────────────
  // Subscribe to forecast-relevant domain events at startup; unsubscribe on
  // close (mirrors NotificationService spine above). Per-project trailing
  // debounce (FORECAST_DEBOUNCE_MS, default 3000ms) collapses bursts into a
  // single full-project rebuild. Fire-and-forget — a forecast failure must
  // never break the emitting mutation (KAN-102).
  const unsubscribeForecast = registerForecastListener(eventBus, app.log);
  app.addHook("onClose", async () => {
    unsubscribeForecast();
  });

  // ─── WorkSession Transition Listener ─────────────────────────────────
  // Subscribes to issue.transitioned events and opens/closes WorkSessions
  // based on the issue state machine (KAN-156 Slice 1). Fire-and-forget —
  // a session failure MUST NEVER break the transition emitter.
  const unsubscribeTransitionListener = registerTransitionListener(eventBus, app.log);
  app.addHook("onClose", async () => {
    unsubscribeTransitionListener();
  });

  const injectedScan = opts.integrationScan;
  let injectedRunning: Promise<unknown> | undefined;
  const integrationWorker = injectedScan
    ? undefined
    : createIntegrationWorkerCycle(prisma, { logger: app.log });
  const integrationScan = injectedScan
    ? () => {
        if (injectedRunning) return injectedRunning;
        const current = Promise.resolve()
          .then(injectedScan)
          .finally(() => {
            if (injectedRunning === current) injectedRunning = undefined;
          });
        injectedRunning = current;
        return current;
      }
    : integrationWorker!;
  const unsubscribeIntegrationSync = registerIntegrationSyncListener(
    eventBus,
    integrationScan,
    app.log
  );
  let stopIntegrationScheduler: (() => Promise<void>) | undefined;
  app.addHook("onReady", async () => {
    try {
      app.log.info(
        await readIntegrationWorkerStartupSnapshot(prisma),
        "Integration worker startup snapshot",
      );
    } catch (err) {
      app.log.error({ err }, "Integration worker startup snapshot failed");
    }
    stopIntegrationScheduler = startIntegrationScheduler(integrationScan, (err) =>
      app.log.error({ err }, "Integration work scan failed")
    );
  });
  app.addHook("onClose", async () => {
    integrationWorker?.stop();
    const listenerDrain = unsubscribeIntegrationSync();
    const schedulerDrain = stopIntegrationScheduler?.() ?? Promise.resolve();
    stopIntegrationScheduler = undefined;
    await Promise.all([listenerDrain, schedulerDrain]);
  });

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
  await app.register(documentRoutes, { prefix: "/api" });
  await app.register(activityRoutes, { prefix: "/api" });
  await app.register(workspaceEventsRoutes, { prefix: "/api/events/workspace" });
  await app.register(memberRoutes, { prefix: "/api/members" });
  await app.register(workspaceMemberRoutes, { prefix: "/api/workspaces/:wid/members" });
  await app.register(roadmapRoutes, { prefix: "/api" });
  await app.register(cycleRoutes, { prefix: "/api" });
  await app.register(workSessionRoutes, { prefix: "/api" });
  await app.register(scheduleRoutes, { prefix: "/api" });
  await app.register(timesheetRoutes, { prefix: "/api" });
  await app.register(milestoneRoutes, { prefix: "/api" });
  await app.register(notificationRoutes, { prefix: "/api/workspaces" });
  await app.register(notificationActionRoutes, { prefix: "/api" });
  await app.register(issueSubscriptionRoutes, { prefix: "/api" });
  await app.register(workspaceInviteRoutes, { prefix: "/api/workspaces/:wid/invites" });
  await app.register(publicInviteRoutes, { prefix: "/api/invites" });
  await app.register(projectMemberRoutes, { prefix: "/api/projects/:key/members" });
  await app.register(instanceRoutes, { prefix: "/api/instance" });
  await app.register(integrationRoutes, { prefix: "/api/integrations" });

  // ─── Instance Setup Token (first-boot onReady hook) ───────────────────
  app.addHook("onReady", async () => {
    try {
      const raw = await bootstrapSetupToken(env.SETUP_TOKEN_TTL_DAYS);
      if (raw) {
        // KAN-83: never put the raw setup token in the structured logger — pino
        // output is what log aggregators ingest, index and retain, and this
        // token grants a one-time super-admin claim. Log only a non-sensitive
        // confirmation through pino; write the token itself straight to stdout
        // for the operator reading boot output.
        app.log.info(
          `[SETUP] Minted instance setup token (valid ${env.SETUP_TOKEN_TTL_DAYS} days). Claim token printed to stdout below.`
        );
        process.stdout.write(
          `\n[SETUP-TOKEN do-not-store] Instance setup token — claim at /setup:\n  ${raw}\n\n`
        );
      }
    } catch (err) {
      app.log.error({ err }, "[SETUP] Failed to bootstrap instance setup token");
    }
  });

  // ─── Work Session Cleanup (self-rescheduling, non-overlapping) ─────
  // Slice A (work-session-resilience): the previous `setInterval` could fire a
  // second tick while a slow DB run was still in flight. Replace it with a
  // `setTimeout` that re-arms itself in `finally`; a module-scoped `running`
  // flag short-circuits overlapping ticks. `onClose` clears the pending timer
  // so no cleanup runs after shutdown begins.
  const CLEANUP_INTERVAL_MS = 60_000;
  let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
  let cleanupRunning = false;

  const scheduleCleanupTick = (): void => {
    cleanupTimer = setTimeout(() => {
      if (cleanupRunning) {
        // Previous run is still in flight — skip this tick and re-arm so the
        // NEXT interval still fires on schedule.
        scheduleCleanupTick();
        return;
      }
      cleanupRunning = true;
      cleanupExpired(app.log)
        .catch((err) => {
          app.log.error({ err }, "Work session cleanup failed");
        })
        .finally(() => {
          cleanupRunning = false;
          scheduleCleanupTick();
        });
    }, CLEANUP_INTERVAL_MS);
    // Allow the process to exit even if this timer is pending.
    cleanupTimer.unref?.();
  };

  app.addHook("onReady", async () => {
    scheduleCleanupTick();
    app.log.info(
      `Work session cleanup interval started (every ${CLEANUP_INTERVAL_MS / 1000}s, non-overlapping)`
    );
  });

  app.addHook("onClose", async () => {
    if (cleanupTimer) {
      clearTimeout(cleanupTimer);
      cleanupTimer = undefined;
      app.log.info("Work session cleanup interval stopped");
    }
  });

  return app;
}

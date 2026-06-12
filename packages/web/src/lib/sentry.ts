import * as Sentry from "@sentry/react";
import type { AnyRouter } from "@tanstack/react-router";

/**
 * Initialize Sentry: error monitoring, performance tracing (TanStack Router),
 * session replay, and structured logs.
 *
 * No-ops unless VITE_SENTRY_DSN is set, so local dev and unconfigured
 * environments stay silent. The React 19 root error handlers are wired in
 * main.tsx (Sentry.reactErrorHandler) so errors caught by the router's error
 * boundary — exactly where the prod white-screens land — get reported.
 *
 * Env vars:
 *   VITE_SENTRY_DSN   public client DSN — Sentry → Settings → Client Keys (DSN).
 *                     Safe to expose in the client bundle. Set in .env / CI.
 * Build-time only (source-map upload — see vite.config.ts), never commit:
 *   SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT
 */
export function initSentry(router: AnyRouter): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return; // not configured → stay silent

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    sendDefaultPii: false, // multi-tenant — do not capture PII by default
    integrations: [
      Sentry.tanstackRouterBrowserTracingIntegration(router),
      Sentry.replayIntegration(),
    ],
    // Performance tracing. Lower this as traffic grows.
    tracesSampleRate: 1.0,
    // Session Replay: 10% of all sessions, but 100% of sessions with an error.
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    // Structured logs (Sentry Logs).
    enableLogs: true,
  });
}

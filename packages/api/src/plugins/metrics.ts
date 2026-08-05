// Observability slice 1 — Prometheus metrics plugin
//
// Wraps fastify-metrics (v13) to:
//   1. Expose GET /metrics with optional Bearer token auth
//   2. Collect Node/process default metrics (CPU, RSS, heap, eventloop lag)
//   3. Record per-route http_request_duration_seconds histogram
//
// Registry injection: tests pass `opts.registry` (fresh per test) to avoid
// prom-client singleton pollution under singleFork: true. In production the
// plugin creates its own Registry. The injected registry is passed to both
// defaultMetrics.register and routeMetrics overrides so ALL metrics land in
// the same isolated store.
//
// ^ceiling: single registry per plugin instance; if multi-tenant registries
// are ever needed, replace opts.registry with a factory fn.

import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import fastifyMetrics, { type IMetricsPluginOptions } from "fastify-metrics";
import client from "prom-client";
import { timingSafeEqual } from "node:crypto";
import {
  registerTriageMetrics,
  type TriageMetrics,
} from "../modules/triage/observability.js";

export interface MetricsPluginOptions {
  /** Inject a custom Registry for test isolation. Defaults to a new Registry(). */
  registry?: client.Registry;
}

declare module "fastify" {
  interface FastifyInstance {
    metricsRegistry: client.Registry;
    triageMetrics: TriageMetrics;
  }
}

/**
 * Constant-time comparison of a bearer Authorization header value against
 * an expected token. Returns false if the header is absent, malformed, or
 * lengths differ (length check is not secret — the token length is known).
 */
export function tokenMatches(
  header: string | string[] | undefined,
  expected: string,
): boolean {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw?.startsWith("Bearer ")) return false;
  const got = Buffer.from(raw.slice(7));
  const want = Buffer.from(expected);
  // timingSafeEqual requires equal-length buffers; length inequality is not secret
  if (got.length !== want.length) return false;
  return timingSafeEqual(got, want);
}

async function metricsPlugin(
  fastify: FastifyInstance,
  opts: MetricsPluginOptions,
): Promise<void> {
  const registry = opts.registry ?? new client.Registry();
  // KAN-193: low-cardinality triage metrics share this registry (no second global).
  const triageMetrics = registerTriageMetrics(registry);
  fastify.decorate("metricsRegistry", registry);
  fastify.decorate("triageMetrics", triageMetrics);

  // Register fastify-metrics for collection only (endpoint: null — we expose
  // /metrics ourselves so we can enforce bearer auth and rate-limit exemption).
  // clearRegisterOnInit: true avoids duplicate-metric errors when the plugin
  // is registered multiple times (e.g. hot-reload or test re-use).
  const metricsOpts: Partial<IMetricsPluginOptions> = {
    endpoint: null,
    defaultMetrics: {
      enabled: true,
      register: registry,
    },
    routeMetrics: {
      enabled: { histogram: true, summary: false }, // summary off — histogram only
      registeredRoutesOnly: true,
      groupStatusCodes: false,
      overrides: {
        histogram: {
          buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
          registers: [registry],
        },
      },
    },
    clearRegisterOnInit: true,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await fastify.register(fastifyMetrics as any, metricsOpts);

  fastify.get(
    "/metrics",
    { config: { rateLimit: false } },
    async (request, reply) => {
      // Read directly from process.env at request time so test setup (which
      // mutates process.env) is visible without busting the lazy env proxy cache.
      // In production, env.ts superRefine guarantees METRICS_TOKEN is set.
      const token = process.env["METRICS_TOKEN"];
      if (token) {
        if (!tokenMatches(request.headers.authorization, token)) {
          return reply.code(401).send("Unauthorized");
        }
      }

      reply.type(registry.contentType);
      return registry.metrics();
    },
  );
}

export default fp(metricsPlugin, { name: "metrics" });

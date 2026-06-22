# Kanon API — Observability Architecture

- Status: Living document — describes the `feat/observability` slice (not yet merged to main at time of writing)
- Date: 2026-06-22
- Decisions it draws from: Observability slice 1 (metrics endpoint, logger hardening)
- Source of truth: `docs/architecture/observability.md`

## 1. Purpose & reading guide

This document describes the observability surface of the Kanon API: what metrics are collected, how they are secured, what the structured logs emit, and how an operator wires up a scraper and log aggregator.

One-sentence summary: **the API exposes a Prometheus-format scrape endpoint protected by a static bearer token, and emits structured pino JSON logs with secrets redacted — two independent signals that feed into whatever monitoring stack the operator chooses.**

## 2. What is shipped in slice 1

| Signal | Mechanism | Status |
|---|---|---|
| Process + route metrics | `GET /metrics` (Prometheus exposition) | Shipped (feat/observability) |
| Structured JSON logs | pino with redaction + base fields | Shipped (feat/observability) |
| Distributed tracing | — | Not yet planned |
| Alerting rules | — | Operator-defined, not in repo |

## 3. Metrics endpoint

### 3.1 Overview

`GET /metrics` returns Prometheus text exposition format. It is served by a hand-rolled Fastify route (not `fastify-metrics`' built-in endpoint) so the plugin can enforce bearer-token auth and opt the route out of the global rate limiter.

```
endpoint: null   ← fastify-metrics does not mount the route
```

The plugin (`packages/api/src/plugins/metrics.ts`) registers `fastify-metrics` (v13) for **collection only**, then mounts its own `/metrics` GET handler.

### 3.2 Collected metrics

**Default metrics** (Node.js / process, via `prom-client`):

- CPU usage
- RSS / heap memory
- Event-loop lag

**Route metrics** (per registered route):

| Metric | Enabled | Notes |
|---|---|---|
| `http_request_duration_seconds` (histogram) | Yes | `registeredRoutesOnly: true` |
| Summary | No | Disabled (`enabled: { histogram: true, summary: false }`) |

`groupStatusCodes: false` — each HTTP status code is a distinct label value.

### 3.3 Histogram bucket boundaries

```
[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]  (seconds)
```

These are the standard Prometheus `DEFAULT_BUCKETS` with no customization beyond explicitly wiring the registry.

### 3.4 Why `endpoint: null` + hand-rolled route

Two requirements cannot be met by `fastify-metrics`' built-in endpoint:

1. **Bearer token auth** — the built-in endpoint has no auth hook.
2. **Rate-limit exemption** — the global rate limiter (1 000 req/min) would throttle a frequent scraper. The hand-rolled route sets `config: { rateLimit: false }` which the `@fastify/rate-limit` plugin reads to skip the bucket.

### 3.5 Registry isolation (tests)

`MetricsPluginOptions.registry` accepts an injected `prom-client` Registry. Tests pass a fresh per-test registry to avoid singleton pollution under `singleFork: true`. In production the plugin creates its own Registry (`new client.Registry()`). `clearRegisterOnInit: true` prevents duplicate-metric errors on hot-reload.

## 4. Authentication

### 4.1 Bearer token

`GET /metrics` is protected by a static bearer token read from `process.env.METRICS_TOKEN` at request time (not at startup) so that test setup that mutates `process.env` is visible without cache-busting.

**Comparison:** `timingSafeEqual` (Node.js `node:crypto`) — constant-time, resistant to timing attacks. The implementation in `tokenMatches()`:

1. Rejects absent or malformed headers (must start with `"Bearer "`).
2. Rejects mismatched lengths (length is not secret — token length is known to any scraper that reads the docs).
3. Only calls `timingSafeEqual` when both buffers are the same length.

### 4.2 Required vs optional

| Environment | `METRICS_TOKEN` required? | Enforced by |
|---|---|---|
| `production` | **Yes** — startup fails without it | `envSchemaWithProductionChecks` `superRefine` in `env.ts` |
| `development` / `test` | Optional — auth skipped if unset | Plugin reads token at request time; no token → no auth check |

### 4.3 JWT exemption scope

`/metrics` is exempted from the JWT `authHook` in `auth.ts`. The exemption matches on the parsed path (query string stripped), and uses `path === "/metrics" || path.startsWith("/metrics/")` — **not** `url.startsWith("/metrics")`. This means a route like `/metricsfoo` cannot bypass JWT auth by exploiting the prefix match. Only `/metrics` and sub-paths (e.g. `/metrics/`) are exempt.

## 5. Structured logging (pino hardening)

### 5.1 Configuration (app.ts)

The Fastify logger is configured with pino directly. In production, no transport is set (raw JSON to stdout). In development, `pino-pretty` is used.

### 5.2 Redacted fields

The following paths are redacted (`"[Redacted]"` substituted by pino) in every log record:

| Path | What it covers |
|---|---|
| `req.headers.authorization` | Bearer tokens (JWT, METRICS_TOKEN) |
| `req.headers.cookie` | Session cookies (`kanon_at`, `kanon_rt`) |
| `req.body.password` | Login request bodies |

> **Note (`^ceiling`):** if new sensitive fields are added (e.g. `req.body.token`, `req.body.refreshToken`), the redact list in `app.ts` must be extended.

### 5.3 Base fields and level format

Every log record includes:

| Field | Value | Why |
|---|---|---|
| `service` | `"kanon-api"` | Identifies the emitter in multi-service aggregators |
| `level` | String (`"info"`) not integer (`30`) | Aligns with CloudWatch / Datadog / Loki expectations |

The `formatters.level` override translates pino's internal integer to a human-readable label before serialization.

### 5.4 No separate logger-hardening module

There is no `logger-hardening.ts` source file. The hardening configuration lives inline in `buildApp()` in `app.ts`. The test file (`packages/api/src/plugins/logger-hardening.test.ts`) builds a Fastify instance with the same logger config and validates the three properties above.

## 6. Operator setup guide

### 6.1 Environment variable

Set `METRICS_TOKEN` to a random string (≥ 32 chars recommended) in your production environment. The API will reject scrape requests without a matching `Authorization: Bearer <token>` header.

```
METRICS_TOKEN=<random-secret>
```

### 6.2 Prometheus scrape config

Configure your Prometheus (or compatible) scraper to hit the API:

```yaml
scrape_configs:
  - job_name: kanon-api
    static_configs:
      - targets: ["api:3000"]
    metrics_path: /metrics
    authorization:
      type: Bearer
      credentials: <METRICS_TOKEN value>
    scrape_interval: 15s
```

### 6.3 Log aggregation

The API emits newline-delimited JSON to stdout. Route it to your aggregator as-is.

> **Note (recommendation):** For BetterStack Logs, use the BetterStack Logs agent or vector pipeline pointed at the container stdout stream. The `service: "kanon-api"` base field makes it straightforward to filter and route in the aggregator UI. No Kanon-side changes are needed — the structured JSON output is already aggregator-ready.

### 6.4 What is not in this slice

| Concern | Status |
|---|---|
| Distributed tracing (OpenTelemetry) | Not implemented — no spans or trace IDs emitted |
| Alerting rules | Operator-defined; no rule files shipped in repo |
| Custom business metrics (e.g. `worklog_created_total`) | Not implemented in slice 1 |

## 7. Module boundary

The observability surface is a thin cross-cutting concern, not a domain module:

| Artifact | Layer | Owns |
|---|---|---|
| `packages/api/src/plugins/metrics.ts` | Plugin | `/metrics` route, collection config, `tokenMatches()` |
| `packages/api/src/app.ts` | Bootstrap | Logger config (redact, base, formatters), plugin registration order |
| `packages/api/src/config/env.ts` | Config | `METRICS_TOKEN` schema, production-required enforcement |

Registration order matters: `metricsPlugin` is registered after `csrfPlugin` (CSRF early-returns on GET, no conflict) and before route modules so all route durations are captured.

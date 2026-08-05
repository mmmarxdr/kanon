import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TRIAGE_PINO_REDACT_PATHS } from "./modules/triage/observability.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("app correlation and triage redaction (KAN-193)", () => {
  const appSource = readFileSync(join(__dirname, "app.ts"), "utf8");

  it("wires genReqId from X-Kanon-Correlation-ID UUID or mints one", () => {
    expect(appSource).toContain("genReqId");
    expect(appSource).toContain("x-kanon-correlation-id");
    expect(appSource).toContain("isCorrelationUuid");
    expect(appSource).toContain("randomUUID");
  });

  it("echoes X-Kanon-Correlation-ID on responses", () => {
    expect(appSource).toContain('reply.header("X-Kanon-Correlation-ID"');
  });

  it("spreads TRIAGE_PINO_REDACT_PATHS into pino redact config", () => {
    expect(appSource).toContain("...TRIAGE_PINO_REDACT_PATHS");
    expect(TRIAGE_PINO_REDACT_PATHS.length).toBeGreaterThan(0);
    expect(TRIAGE_PINO_REDACT_PATHS).toContain("req.body.suggestions");
  });
});

// Lightweight runtime check — only when DB/env allow full buildApp.
const runRuntime = process.env["TRIAGE_APP_RUNTIME"] === "1";

describe.skipIf(!runRuntime)("app runtime correlation continuity", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;

  beforeAll(async () => {
    const { buildApp } = await import("./app.js");
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("accepts inbound correlation UUID and returns it", async () => {
    const correlationId = "550e8400-e29b-41d4-a716-446655440000";
    const res = await app.inject({
      method: "GET",
      url: "/health",
      headers: { "x-kanon-correlation-id": correlationId },
    });
    expect(res.headers["x-kanon-correlation-id"]).toBe(correlationId);
  });
});

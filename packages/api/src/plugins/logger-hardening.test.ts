// Observability slice 1 — pino logger hardening tests
//
// Verifies that the Fastify app logger:
//   1. Redacts Authorization header (no raw Bearer token in logs)
//   2. Includes service base field in every log record
//   3. Emits level as a string ("info") not an integer (30)
//
// Strategy: build a bare Fastify instance with the SAME logger config as
// app.ts, write logs to a captured stream, parse JSON records.

import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { Writable } from "node:stream";

/**
 * Build a Fastify instance with the production-equivalent pino config
 * (no pino-pretty, JSON output to a capture stream).
 */
function buildLogCapture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });

  // Mirror the logger config from app.ts but force JSON output (no transport)
  // so we can parse the records.
  const app = Fastify({
    logger: {
      level: "info",
      stream,
      redact: ["req.headers.authorization", "req.headers.cookie", "req.body.password"],
      base: { service: "kanon-api" },
      formatters: {
        level: (label: string) => ({ level: label }),
      },
    },
  });

  return { app, lines };
}

describe("pino logger hardening", () => {
  it("log level is emitted as a string label, not an integer", async () => {
    const { app, lines } = buildLogCapture();

    app.get("/ping", async () => ({ ok: true }));
    await app.ready();
    await app.inject({ method: "GET", url: "/ping" });
    await app.close();

    // Find a log line that has a level field
    const parsed = lines
      .map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      })
      .filter(Boolean);

    const withLevel = parsed.filter((r) => "level" in r);
    expect(withLevel.length).toBeGreaterThan(0);
    // Every level field must be a string, never a number
    for (const record of withLevel) {
      expect(typeof record.level).toBe("string");
      expect(record.level).not.toBe(30); // pino integer for "info"
    }
  });

  it("every log record includes the service base field", async () => {
    const { app, lines } = buildLogCapture();

    app.get("/ping", async () => ({ ok: true }));
    await app.ready();
    await app.inject({ method: "GET", url: "/ping" });
    await app.close();

    const parsed = lines
      .map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      })
      .filter(Boolean);

    expect(parsed.length).toBeGreaterThan(0);
    for (const record of parsed) {
      expect(record.service).toBe("kanon-api");
    }
  });

  it("Authorization header is redacted in request logs", async () => {
    const { app, lines } = buildLogCapture();

    app.get("/secret", async () => ({ ok: true }));
    await app.ready();

    await app.inject({
      method: "GET",
      url: "/secret",
      headers: { authorization: "Bearer super-secret-token" },
    });
    await app.close();

    // The raw token must never appear in any log line
    const combined = lines.join("\n");
    expect(combined).not.toContain("super-secret-token");
    expect(combined).not.toContain("Bearer super-secret-token");

    // The redacted path should appear as [Redacted] in at least one line
    const parsed = lines
      .map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      })
      .filter(Boolean);

    const requestLog = parsed.find(
      (r) => r.req?.headers?.authorization !== undefined,
    );
    if (requestLog) {
      expect(requestLog.req.headers.authorization).toBe("[Redacted]");
    }
  });
});

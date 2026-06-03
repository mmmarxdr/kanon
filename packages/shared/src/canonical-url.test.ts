import { describe, it, expect } from "vitest";
import { canonicalizeApiUrl } from "./canonical-url.js";

describe("canonicalizeApiUrl", () => {
  // ── trailing slash stripping ──────────────────────────────────────────────
  it("strips a single trailing slash", () => {
    expect(canonicalizeApiUrl("https://api.example.com/")).toBe(
      "https://api.example.com",
    );
  });

  it("strips multiple trailing slashes", () => {
    expect(canonicalizeApiUrl("https://api.example.com///")).toBe(
      "https://api.example.com",
    );
  });

  it("leaves a URL with no trailing slash unchanged", () => {
    expect(canonicalizeApiUrl("https://api.example.com")).toBe(
      "https://api.example.com",
    );
  });

  // ── host lowercasing ──────────────────────────────────────────────────────
  it("lowercases the host", () => {
    expect(canonicalizeApiUrl("https://API.EXAMPLE.COM")).toBe(
      "https://api.example.com",
    );
  });

  it("lowercases scheme and host together", () => {
    expect(canonicalizeApiUrl("HTTPS://API.EXAMPLE.COM")).toBe(
      "https://api.example.com",
    );
  });

  // ── default port normalization ────────────────────────────────────────────
  it("strips explicit :443 from https URL", () => {
    expect(canonicalizeApiUrl("https://api.example.com:443")).toBe(
      "https://api.example.com",
    );
  });

  it("strips explicit :80 from http URL", () => {
    expect(canonicalizeApiUrl("http://api.example.com:80")).toBe(
      "http://api.example.com",
    );
  });

  it("keeps non-default port on https", () => {
    expect(canonicalizeApiUrl("https://api.example.com:8443")).toBe(
      "https://api.example.com:8443",
    );
  });

  it("keeps non-default port on http", () => {
    expect(canonicalizeApiUrl("http://api.example.com:3000")).toBe(
      "http://api.example.com:3000",
    );
  });

  // ── path and query stripping ──────────────────────────────────────────────
  it("drops path components", () => {
    expect(canonicalizeApiUrl("https://api.example.com/v1/users")).toBe(
      "https://api.example.com",
    );
  });

  it("drops query string", () => {
    expect(canonicalizeApiUrl("https://api.example.com?foo=bar")).toBe(
      "https://api.example.com",
    );
  });

  it("drops both path and query", () => {
    expect(canonicalizeApiUrl("https://api.example.com/v1?foo=bar")).toBe(
      "https://api.example.com",
    );
  });

  // ── localhost → http ──────────────────────────────────────────────────────
  it("uses http for localhost", () => {
    expect(canonicalizeApiUrl("https://localhost")).toBe("http://localhost");
  });

  it("uses http for localhost with port", () => {
    expect(canonicalizeApiUrl("https://localhost:3000")).toBe(
      "http://localhost:3000",
    );
  });

  it("uses http for 127.0.0.1", () => {
    expect(canonicalizeApiUrl("https://127.0.0.1")).toBe("http://127.0.0.1");
  });

  it("keeps http for localhost already using http", () => {
    expect(canonicalizeApiUrl("http://localhost:3000")).toBe(
      "http://localhost:3000",
    );
  });

  // ── parity: two drift variants → same key ────────────────────────────────
  it("two installs targeting same host with and without trailing slash produce identical keys", () => {
    const a = canonicalizeApiUrl("https://host.example.com/api");
    const b = canonicalizeApiUrl("https://host.example.com/api/");
    expect(a).toBe(b);
  });

  it("https://host and https://host:443 produce identical keys", () => {
    const a = canonicalizeApiUrl("https://host.example.com:443");
    const b = canonicalizeApiUrl("https://host.example.com");
    expect(a).toBe(b);
  });

  // ── IPv6 host handling ────────────────────────────────────────────────────
  it("preserves bracketed IPv6 host", () => {
    expect(canonicalizeApiUrl("http://[2001:db8::1]/")).toBe("http://[2001:db8::1]");
  });

  it("preserves bracketed IPv6 host with port", () => {
    expect(canonicalizeApiUrl("http://[2001:db8::1]:3000/api")).toBe("http://[2001:db8::1]:3000");
  });

  it("uses http for loopback IPv6 ::1", () => {
    expect(canonicalizeApiUrl("https://[::1]:3000")).toBe("http://[::1]:3000");
  });

  it("two IPv6 installs with and without trailing slash produce identical keys", () => {
    const a = canonicalizeApiUrl("http://[2001:db8::1]/api");
    const b = canonicalizeApiUrl("http://[2001:db8::1]/api/");
    expect(a).toBe(b);
  });
});

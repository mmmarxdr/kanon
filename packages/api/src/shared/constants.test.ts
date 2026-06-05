import { describe, it, expect } from "vitest";
import { getCookieConfig, TOKEN_EXPIRY } from "./constants.js";

// Regression guard: access cookie maxAge and TOKEN_EXPIRY.ACCESS must stay
// in sync. If one is changed without the other, browser sessions would silently
// evict the cookie before the JWT expires (or vice versa). See design AD4.

describe("getCookieConfig — access cookie maxAge", () => {
  it("access.maxAge is 3600 (1 hour) — must match TOKEN_EXPIRY.ACCESS", () => {
    const config = getCookieConfig(false);
    expect(config.access.maxAge).toBe(3600);
  });

  it("TOKEN_EXPIRY.ACCESS is '1h'", () => {
    expect(TOKEN_EXPIRY.ACCESS).toBe("1h");
  });

  it("refresh.maxAge is 604800 (7 days — unchanged)", () => {
    const config = getCookieConfig(false);
    expect(config.refresh.maxAge).toBe(604800);
  });
});

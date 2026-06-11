import { describe, it, expect } from "vitest";
import { UpdateProfileBody } from "./schema.js";

describe("UpdateProfileBody.avatarUrl (KAN-81)", () => {
  const parse = (avatarUrl: unknown) => UpdateProfileBody.safeParse({ avatarUrl });

  it("accepts an https URL", () => {
    expect(parse("https://cdn.example.com/a.png").success).toBe(true);
  });

  it("accepts uppercase HTTPS scheme (case-insensitive)", () => {
    expect(parse("HTTPS://cdn.example.com/a.png").success).toBe(true);
  });

  it("accepts null and absent (clearing / not provided)", () => {
    expect(parse(null).success).toBe(true);
    expect(UpdateProfileBody.safeParse({}).success).toBe(true);
  });

  it("rejects http:// (downgrade / mixed-content)", () => {
    expect(parse("http://cdn.example.com/a.png").success).toBe(false);
  });

  it("rejects javascript: and data: URLs (XSS / phishing)", () => {
    expect(parse("javascript:alert(1)").success).toBe(false);
    expect(parse("data:image/png;base64,AAAA").success).toBe(false);
  });

  it("rejects a non-URL string", () => {
    expect(parse("not a url").success).toBe(false);
  });

  it("rejects a URL longer than 2048 chars", () => {
    const long = "https://cdn.example.com/" + "a".repeat(2100);
    expect(parse(long).success).toBe(false);
  });
});

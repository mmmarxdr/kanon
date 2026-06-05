import { describe, it, expect } from "vitest";
import {
  OnboardBodySchema,
  OnboardResponseSchema,
  ExchangeBodySchema,
  ExchangeResponseSchema,
  OnboardingInviteBodySchema,
  OnboardingInviteResponseSchema,
} from "./api-types.js";

// ── OnboardBodySchema ─────────────────────────────────────────────────────────

describe("OnboardBodySchema", () => {
  it("parses valid input", () => {
    const result = OnboardBodySchema.parse({ token: "a".repeat(20) });
    expect(result).toEqual({ token: "a".repeat(20) });
  });

  it("rejects missing token", () => {
    expect(() => OnboardBodySchema.parse({})).toThrow();
  });

  it("rejects token shorter than 20 chars", () => {
    expect(() => OnboardBodySchema.parse({ token: "short" })).toThrow();
  });
});

// ── OnboardResponseSchema ─────────────────────────────────────────────────────

describe("OnboardResponseSchema", () => {
  const valid = {
    refreshToken: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyMSJ9.sig",
    apiUrl: "https://app.example.com",
    workspace: {
      id: "550e8400-e29b-41d4-a716-446655440000",
      slug: "my-workspace",
      name: "My Workspace",
    },
    email: "dev@example.com",
    expiresAt: "2026-05-28T14:00:00.000Z",
  };

  it("parses valid response", () => {
    const result = OnboardResponseSchema.parse(valid);
    expect(result.refreshToken).toBe(valid.refreshToken);
    expect(result.workspace.slug).toBe("my-workspace");
    expect(result.email).toBe("dev@example.com");
  });

  it("rejects missing refreshToken", () => {
    const { refreshToken: _, ...rest } = valid;
    expect(() => OnboardResponseSchema.parse(rest)).toThrow(/Required/);
  });

  it("rejects invalid apiUrl (not a URL)", () => {
    expect(() =>
      OnboardResponseSchema.parse({ ...valid, apiUrl: "not-a-url" })
    ).toThrow();
  });

  it("rejects invalid email", () => {
    expect(() =>
      OnboardResponseSchema.parse({ ...valid, email: "not-an-email" })
    ).toThrow();
  });

  it("rejects workspace missing id", () => {
    expect(() =>
      OnboardResponseSchema.parse({
        ...valid,
        workspace: { slug: "s", name: "n" },
      })
    ).toThrow(/Required/);
  });
});

// ── ExchangeBodySchema ────────────────────────────────────────────────────────

describe("ExchangeBodySchema", () => {
  it("parses valid input", () => {
    const token = "a".repeat(40);
    const result = ExchangeBodySchema.parse({ refreshToken: token });
    expect(result.refreshToken).toBe(token);
  });

  it("rejects missing refreshToken", () => {
    expect(() => ExchangeBodySchema.parse({})).toThrow(/Required/);
  });

  it("rejects refreshToken shorter than 40 chars", () => {
    expect(() =>
      ExchangeBodySchema.parse({ refreshToken: "short" })
    ).toThrow();
  });
});

// ── ExchangeResponseSchema ────────────────────────────────────────────────────

describe("ExchangeResponseSchema", () => {
  const valid = {
    accessToken: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyMSJ9.sig",
    expiresIn: 3600,
  };

  it("parses valid response", () => {
    const result = ExchangeResponseSchema.parse(valid);
    expect(result.accessToken).toBe(valid.accessToken);
    expect(result.expiresIn).toBe(3600);
  });

  it("rejects missing accessToken", () => {
    expect(() => ExchangeResponseSchema.parse({ expiresIn: 900 })).toThrow(
      /Required/
    );
  });

  it("rejects non-integer expiresIn", () => {
    expect(() =>
      ExchangeResponseSchema.parse({ accessToken: "tok", expiresIn: 900.5 })
    ).toThrow();
  });

  it("rejects string expiresIn", () => {
    expect(() =>
      ExchangeResponseSchema.parse({ accessToken: "tok", expiresIn: "900" })
    ).toThrow(/Expected number/);
  });
});

// ── OnboardingInviteBodySchema ────────────────────────────────────────────────

describe("OnboardingInviteBodySchema", () => {
  it("parses valid input with all fields", () => {
    const result = OnboardingInviteBodySchema.parse({
      email: "dev@example.com",
      role: "MEMBER",
      ttlHours: 48,
    });
    expect(result.email).toBe("dev@example.com");
    expect(result.role).toBe("MEMBER");
    expect(result.ttlHours).toBe(48);
  });

  it("parses with all optional fields absent (defaults applied)", () => {
    const result = OnboardingInviteBodySchema.parse({});
    expect(result.role).toBe("MEMBER");
    expect(result.ttlHours).toBe(72);
  });

  it("rejects invalid email", () => {
    expect(() =>
      OnboardingInviteBodySchema.parse({ email: "bad" })
    ).toThrow();
  });

  it("rejects ttlHours > 72", () => {
    expect(() =>
      OnboardingInviteBodySchema.parse({ ttlHours: 73 })
    ).toThrow();
  });

  it("rejects ttlHours < 1", () => {
    expect(() =>
      OnboardingInviteBodySchema.parse({ ttlHours: 0 })
    ).toThrow();
  });
});

// ── OnboardingInviteResponseSchema ────────────────────────────────────────────

describe("OnboardingInviteResponseSchema", () => {
  const valid = {
    inviteId: "550e8400-e29b-41d4-a716-446655440000",
    url: "kanon://app.example.com/onboard?token=abc.def.ghi",
    token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJpbnZpdGUxIn0.sig",
    expiresAt: "2026-05-01T14:00:00.000Z",
  };

  it("parses valid response", () => {
    const result = OnboardingInviteResponseSchema.parse(valid);
    expect(result.inviteId).toBe(valid.inviteId);
    expect(result.url).toBe(valid.url);
    expect(result.token).toBe(valid.token);
  });

  it("rejects missing inviteId", () => {
    const { inviteId: _, ...rest } = valid;
    expect(() => OnboardingInviteResponseSchema.parse(rest)).toThrow(
      /Required/
    );
  });

  it("rejects non-UUID inviteId", () => {
    expect(() =>
      OnboardingInviteResponseSchema.parse({ ...valid, inviteId: "not-a-uuid" })
    ).toThrow();
  });

  it("rejects missing token", () => {
    const { token: _, ...rest } = valid;
    expect(() => OnboardingInviteResponseSchema.parse(rest)).toThrow(
      /Required/
    );
  });
});

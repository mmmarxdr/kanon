import { describe, expect, it, vi } from "vitest";
import { createPinnedLookup, resolveSafeEndpoint } from "./http-client.js";

describe("Redmine network guard", () => {
  it("resolves public HTTPS endpoints and pins the vetted address", async () => {
    const resolve = vi.fn().mockResolvedValue([
      { address: "203.0.114.10", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ]);

    const endpoint = await resolveSafeEndpoint("https://redmine.example/api", { resolve });

    expect(resolve).toHaveBeenCalledWith("redmine.example");
    expect(endpoint).toEqual({
      url: "https://redmine.example/api",
      hostname: "redmine.example",
      address: "203.0.114.10",
      family: 4,
    });

    const lookup = createPinnedLookup(endpoint);
    await expect(
      new Promise((resolveLookup, reject) => {
        lookup("redmine.example", {}, (error, address, family) =>
          error ? reject(error) : resolveLookup({ address, family }),
        );
      }),
    ).resolves.toEqual({ address: "203.0.114.10", family: 4 });
  });

  it.each([
    "http://redmine.example",
    "ftp://redmine.example",
    "https://user:secret@redmine.example",
    "https://127.0.0.1",
    "https://2130706433",
    "https://169.254.169.254/latest/meta-data",
    "https://10.0.0.1",
    "https://172.16.0.1",
    "https://192.168.0.1",
    "https://[::]",
    "https://[::1]",
    "https://[::ffff:127.0.0.1]",
    "https://[fc00::1]",
    "https://[fec0::1]",
    "https://[fe80::1]",
  ])("rejects unsafe endpoint %s", async (url) => {
    await expect(resolveSafeEndpoint(url)).rejects.toThrow("Unsafe remote endpoint");
  });

  it("allows an exact HTTP origin only at its configured private address", async () => {
    const resolve = vi.fn().mockResolvedValue([{ address: "10.20.30.40", family: 4 }]);
    const endpointAllowlist = {
      "http://redmine.internal.example": ["10.20.30.40"],
    };

    const endpoint = await resolveSafeEndpoint("http://redmine.internal.example/redmine", {
      endpointAllowlist,
      resolve,
    });

    expect(endpoint).toMatchObject({
      url: "http://redmine.internal.example/redmine",
      address: "10.20.30.40",
    });
    const pinnedLookup = createPinnedLookup(endpoint, endpointAllowlist);
    await expect(
      new Promise((resolveLookup, reject) => {
        pinnedLookup("redmine.internal.example", {}, (error, address, family) =>
          error ? reject(error) : resolveLookup({ address, family }),
        );
      }),
    ).resolves.toEqual({ address: "10.20.30.40", family: 4 });
  });

  it("canonicalizes equivalent IPv6 DNS answers before matching and pinning", async () => {
    const endpointAllowlist = { "http://redmine.internal.example": ["fd00::1"] };
    const endpoint = await resolveSafeEndpoint("http://redmine.internal.example", {
      endpointAllowlist,
      resolve: async () => [{ address: "FD00:0:0:0:0:0:0:1", family: 6 }],
    });

    expect(endpoint.address).toBe("fd00::1");
    const pinnedLookup = createPinnedLookup(endpoint, endpointAllowlist);
    await expect(
      new Promise((resolveLookup, reject) => {
        pinnedLookup("redmine.internal.example", {}, (error, address, family) =>
          error ? reject(error) : resolveLookup({ address, family }),
        );
      }),
    ).resolves.toEqual({ address: "fd00::1", family: 6 });
  });

  it.each([
    ["http://other.internal.example", [{ address: "10.20.30.40", family: 4 }]],
    ["http://redmine.internal.example", [{ address: "10.20.30.41", family: 4 }]],
    [
      "http://redmine.internal.example",
      [
        { address: "10.20.30.40", family: 4 },
        { address: "10.20.30.41", family: 4 },
      ],
    ],
  ] as const)("rejects HTTP endpoint %s when origin or DNS answers mismatch", async (url, answers) => {
    await expect(
      resolveSafeEndpoint(url, {
        endpointAllowlist: { "http://redmine.internal.example": ["10.20.30.40"] },
        resolve: async () => answers,
      }),
    ).rejects.toThrow("Unsafe remote endpoint");
  });

  it("preserves URL credential rejection for an allowlisted origin", async () => {
    await expect(
      resolveSafeEndpoint("http://user:secret@redmine.internal.example", {
        endpointAllowlist: { "http://redmine.internal.example": ["10.20.30.40"] },
        resolve: async () => [{ address: "10.20.30.40", family: 4 }],
      }),
    ).rejects.toThrow("URL credentials are forbidden");
  });

  it("rejects a hostname when any DNS answer is not public", async () => {
    const resolve = vi.fn().mockResolvedValue([
      { address: "203.0.114.10", family: 4 },
      { address: "10.0.0.8", family: 4 },
    ]);

    await expect(resolveSafeEndpoint("https://redmine.example", { resolve })).rejects.toThrow(
      "Unsafe remote endpoint",
    );
  });

  it("re-resolves each request and blocks DNS rebinding", async () => {
    const resolve = vi
      .fn()
      .mockResolvedValueOnce([{ address: "203.0.114.10", family: 4 }])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);

    await expect(resolveSafeEndpoint("https://redmine.example", { resolve })).resolves.toMatchObject({
      address: "203.0.114.10",
    });
    await expect(resolveSafeEndpoint("https://redmine.example", { resolve })).rejects.toThrow(
      "Unsafe remote endpoint",
    );
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("refuses to use a pin for another hostname", async () => {
    const endpoint = await resolveSafeEndpoint("https://redmine.example", {
      resolve: async () => [{ address: "203.0.114.10", family: 4 }],
    });
    const lookup = createPinnedLookup(endpoint);

    await expect(
      new Promise((resolveLookup, reject) => {
        lookup("attacker.example", {}, (error, address, family) =>
          error ? reject(error) : resolveLookup({ address, family }),
        );
      }),
    ).rejects.toThrow("hostname does not match vetted endpoint");
  });
});

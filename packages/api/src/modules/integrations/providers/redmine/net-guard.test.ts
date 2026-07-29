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

  it("allows public HTTP only with explicit opt-in", async () => {
    const resolve = vi.fn().mockResolvedValue([{ address: "203.0.114.10", family: 4 }]);

    await expect(
      resolveSafeEndpoint("http://redmine.example", { allowHttp: true, resolve }),
    ).resolves.toMatchObject({ url: "http://redmine.example/" });
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

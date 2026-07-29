import { afterEach, describe, expect, it, vi } from "vitest";
process.env["COOKIE_SECRET"] =
  process.env["COOKIE_SECRET"] ?? "test-cookie-secret-at-least-32-chars-long";
import { buildApp } from "../../app.js";
import { startIntegrationScheduler } from "./scheduler.js";

describe("integration scheduler", () => {
  afterEach(() => vi.useRealTimers());

  it("does not run after stop clears a pending tick", async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockResolvedValue([]);
    const stop = startIntegrationScheduler(run, vi.fn(), 100);

    stop();
    await vi.advanceTimersByTimeAsync(500);

    expect(run).not.toHaveBeenCalled();
  });

  it("does not overlap or rearm when stopped during an in-flight run", async () => {
    vi.useFakeTimers();
    let resolveRun!: () => void;
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRun = resolve;
        }),
    );
    const stop = startIntegrationScheduler(run, vi.fn(), 100);

    await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(500);
    expect(run).toHaveBeenCalledOnce();

    stop();
    resolveRun();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(500);
    expect(run).toHaveBeenCalledOnce();
  });

  it("reports a failed run and schedules the next tick", async () => {
    vi.useFakeTimers();
    const error = new Error("scan failed");
    const run = vi.fn().mockRejectedValueOnce(error).mockResolvedValue([]);
    const onError = vi.fn(() => {
      throw new Error("logger failed");
    });
    const stop = startIntegrationScheduler(run, onError, 100);

    await vi.advanceTimersByTimeAsync(100);
    expect(onError).toHaveBeenCalledWith(error);
    await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
  });

  it("starts on app ready and stops on app close", async () => {
    vi.useFakeTimers();
    const scan = vi.fn().mockResolvedValue([]);
    const app = await buildApp({ integrationScan: scan });
    await app.ready();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(scan).toHaveBeenCalledOnce();
    await app.close();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(scan).toHaveBeenCalledOnce();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
const worker = vi.hoisted(() => {
  const stop = vi.fn();
  return { run: Object.assign(vi.fn().mockResolvedValue(undefined), { stop }), stop };
});
const createWorker = vi.hoisted(() => vi.fn(() => worker.run));
const startupSnapshot = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    queued: 1,
    retry: 2,
    ambiguous: 3,
    dead: 4,
    oldestDueAt: new Date("2026-07-30T12:00:00.000Z"),
  }),
);
vi.mock("./worker.js", () => ({
  createIntegrationWorkerCycle: createWorker,
  readIntegrationWorkerStartupSnapshot: startupSnapshot,
}));
process.env["COOKIE_SECRET"] =
  process.env["COOKIE_SECRET"] ?? "test-cookie-secret-at-least-32-chars-long";
import { buildApp } from "../../app.js";
import { startIntegrationScheduler } from "./scheduler.js";

describe("integration scheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("does not run after stop clears a pending tick", async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockResolvedValue([]);
    const stop = startIntegrationScheduler(run, vi.fn(), 100);

    await stop();
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

    const drain = stop();
    let drained = false;
    void drain.then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    resolveRun();
    await drain;
    expect(drained).toBe(true);
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
    await stop();
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

  it("activates one default worker closure and logs the startup snapshot", async () => {
    const app = await buildApp();
    const info = vi.spyOn(app.log, "info");

    await app.ready();

    expect(createWorker).toHaveBeenCalledOnce();
    expect(createWorker).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ logger: app.log }),
    );
    expect(startupSnapshot).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalledWith(
      {
        queued: 1,
        retry: 2,
        ambiguous: 3,
        dead: 4,
        oldestDueAt: new Date("2026-07-30T12:00:00.000Z"),
      },
      "Integration worker startup snapshot",
    );
    await app.close();
    expect(worker.stop).toHaveBeenCalledOnce();
  });
});

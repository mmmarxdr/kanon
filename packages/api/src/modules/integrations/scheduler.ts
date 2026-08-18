const DEFAULT_INTERVAL_MS = 60_000;

function startScheduler(
  run: (signal?: AbortSignal) => Promise<unknown>,
  onError: (error: unknown) => void,
  intervalMs: number,
  abortOnStop: boolean,
): () => Promise<void> {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | undefined;
  let controller: AbortController | undefined;

  const schedule = (): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      timer = undefined;
      controller = abortOnStop ? new AbortController() : undefined;
      const current = (async () => {
        try {
          await run(controller?.signal);
        } catch (error) {
          try {
            onError(error);
          } catch {
            // Error reporting must not stop future scans.
          }
        } finally {
          controller = undefined;
          schedule();
        }
      })();
      inFlight = current;
      void current.finally(() => {
        if (inFlight === current) inFlight = undefined;
      });
    }, intervalMs);
    timer.unref?.();
  };

  schedule();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = undefined;
    controller?.abort();
    return inFlight ?? Promise.resolve();
  };
}

export function startIntegrationScheduler(
  run: () => Promise<unknown>,
  onError: (error: unknown) => void,
  intervalMs = DEFAULT_INTERVAL_MS,
): () => Promise<void> {
  return startScheduler(() => run(), onError, intervalMs, false);
}

export function startAuditScheduler(
  run: (signal: AbortSignal) => Promise<unknown>,
  onError: (error: unknown) => void,
  intervalMs: number,
): () => Promise<void> {
  return startScheduler((signal) => run(signal!), onError, intervalMs, true);
}

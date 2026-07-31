const DEFAULT_INTERVAL_MS = 60_000;

export function startIntegrationScheduler(
  run: () => Promise<unknown>,
  onError: (error: unknown) => void,
  intervalMs = DEFAULT_INTERVAL_MS,
): () => Promise<void> {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | undefined;

  const schedule = (): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      timer = undefined;
      const current = (async () => {
        try {
          await run();
        } catch (error) {
          try {
            onError(error);
          } catch {
            // Error reporting must not stop future scans.
          }
        } finally {
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
    return inFlight ?? Promise.resolve();
  };
}

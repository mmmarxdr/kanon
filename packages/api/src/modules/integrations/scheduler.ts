const DEFAULT_INTERVAL_MS = 60_000;

export function startIntegrationScheduler(
  run: () => Promise<unknown>,
  onError: (error: unknown) => void,
  intervalMs = DEFAULT_INTERVAL_MS,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = (): void => {
    if (stopped) return;
    timer = setTimeout(async () => {
      timer = undefined;
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
    }, intervalMs);
    timer.unref?.();
  };

  schedule();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
}

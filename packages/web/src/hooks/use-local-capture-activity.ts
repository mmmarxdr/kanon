import { useEffect, useSyncExternalStore } from "react";
import type { CaptureScope } from "@/lib/work-capture-browser-store";
import { workCaptureLifecycle } from "@/lib/work-capture-lifecycle";

interface CaptureLifecycleHookPort {
  activateScope(scope: CaptureScope): Promise<void>;
  installActivityListeners(): () => void;
  getSnapshot(): ReturnType<typeof workCaptureLifecycle.getSnapshot>;
  subscribe(listener: () => void): () => void;
}

export function useLocalCaptureActivity(
  scope: CaptureScope | null,
  lifecycle: CaptureLifecycleHookPort = workCaptureLifecycle,
) {
  const principalId = scope?.principalId;
  const workspaceId = scope?.workspaceId;
  const snapshot = useSyncExternalStore(
    lifecycle.subscribe,
    lifecycle.getSnapshot,
    lifecycle.getSnapshot,
  );

  useEffect(() => {
    if (!principalId || !workspaceId) return;
    void lifecycle.activateScope({ principalId, workspaceId }).catch(() => {
      // Unsupported coordination/storage and invalid hydration fail closed.
    });
  }, [principalId, workspaceId, lifecycle]);

  useEffect(() => lifecycle.installActivityListeners(), [lifecycle]);

  return snapshot;
}

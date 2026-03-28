import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/auth-store";
import { SseClient, type SyncStatus, type SyncEvent } from "@/lib/sse-client";
import { issueKeys } from "@/lib/query-keys";
import { useToastStore } from "@/stores/toast-store";

const MAX_HISTORY = 20;

export interface UseSyncEventsReturn {
  status: SyncStatus;
  lastSyncAt: string | null;
  syncHistory: SyncEvent[];
  isManualSyncing: boolean;
  triggerSync: () => Promise<void>;
}

/**
 * Connects to the SSE sync endpoint and invalidates TanStack Query caches
 * when sync events arrive.
 *
 * - On `sync_complete`: invalidates issue queries so the board refreshes.
 * - On reconnect: also invalidates (full refresh to catch missed events).
 * - Only connects when the user is authenticated.
 * - Cleans up the SSE connection on unmount.
 * - Tracks sync history (ring buffer, max 20 events).
 * - Exposes triggerSync() for manual sync via POST /api/events/sync/trigger.
 * - Shows toast notifications on sync_complete (with changes) and sync_error.
 */
export function useSyncEvents(): UseSyncEventsReturn {
  const [status, setStatus] = useState<SyncStatus>("disconnected");
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [isManualSyncing, setIsManualSyncing] = useState(false);
  const syncHistoryRef = useRef<SyncEvent[]>([]);
  const [syncHistory, setSyncHistory] = useState<SyncEvent[]>([]);
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const clientRef = useRef<SseClient | null>(null);

  useEffect(() => {
    // Don't connect if not authenticated
    if (!isAuthenticated) {
      setStatus("disconnected");
      return;
    }

    const sseUrl = `${window.location.origin}/api/events/sync`;
    const client = new SseClient(sseUrl);
    clientRef.current = client;

    const unsubStatus = client.onStatusChange((newStatus) => {
      setStatus(newStatus);
    });

    const unsubEvent = client.onEvent((event: SyncEvent) => {
      if (event.type === "sync_complete" || event.type === "reconnected") {
        // Invalidate all issue queries — board will refetch
        queryClient.invalidateQueries({ queryKey: issueKeys.all });
      }

      if (event.type === "sync_complete") {
        setLastSyncAt(event.timestamp);

        // Add to ring buffer
        const updated = [event, ...syncHistoryRef.current].slice(0, MAX_HISTORY);
        syncHistoryRef.current = updated;
        setSyncHistory(updated);

        // Toast for non-zero changes
        const changedCount = (event as Record<string, unknown>).changedCount as number | undefined;
        if (changedCount && changedCount > 0) {
          useToastStore
            .getState()
            .addToast(`Synced ${changedCount} item${changedCount === 1 ? "" : "s"} from Engram`, "success");
        }
      }

      if (event.type === "sync_error") {
        // Add to ring buffer
        const updated = [event, ...syncHistoryRef.current].slice(0, MAX_HISTORY);
        syncHistoryRef.current = updated;
        setSyncHistory(updated);

        const message = (event as Record<string, unknown>).message as string | undefined;
        useToastStore
          .getState()
          .addToast(`Sync error: ${message ?? "Unknown error"}`, "error");
      }
    });

    client.connect();

    return () => {
      unsubStatus();
      unsubEvent();
      client.close();
      clientRef.current = null;
    };
  }, [isAuthenticated, queryClient]);

  const triggerSync = useCallback(async () => {
    if (!isAuthenticated || isManualSyncing) return;

    setIsManualSyncing(true);
    try {
      await fetch("/api/events/sync/trigger", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
      });
    } catch {
      // Network error — toast will come from SSE sync_error event
    } finally {
      setIsManualSyncing(false);
    }
  }, [isAuthenticated, isManualSyncing]);

  return { status, lastSyncAt, syncHistory, isManualSyncing, triggerSync };
}

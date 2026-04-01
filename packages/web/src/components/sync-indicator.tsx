import { useEffect, useRef, useState } from "react";
import type { SyncStatus, SyncEvent } from "@/lib/sse-client";
import { useI18n } from "@/hooks/use-i18n";
import type { MessageKey } from "@/i18n/messages";

const STATUS_CONFIG: Record<
  SyncStatus,
  { color: string; pulse: boolean; labelKey: MessageKey }
> = {
  connected: {
    color: "bg-emerald-500",
    pulse: false,
    labelKey: "sync.status.connected",
  },
  connecting: {
    color: "bg-teal-400",
    pulse: true,
    labelKey: "sync.status.connecting",
  },
  disconnected: {
    color: "bg-gray-400",
    pulse: false,
    labelKey: "sync.status.disconnected",
  },
  error: {
    color: "bg-red-500",
    pulse: false,
    labelKey: "sync.status.error",
  },
};

export interface SyncIndicatorProps {
  status: SyncStatus | null;
  lastSyncAt: string | null;
  syncHistory: SyncEvent[];
  isManualSyncing: boolean;
  onTriggerSync: () => Promise<void>;
}

/**
 * Format a timestamp as a relative time string (e.g. "2 min ago").
 */
function formatRelativeTime(
  timestamp: string,
  t: (key: MessageKey) => string,
): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 5) return t("sync.relative.justNow");
  if (diffSec < 60) return `${diffSec}${t("sync.relative.secondsAgoSuffix")}`;

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}${t("sync.relative.minutesAgoSuffix")}`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}${t("sync.relative.hoursAgoSuffix")}`;

  return `${Math.floor(diffHr / 24)}${t("sync.relative.daysAgoSuffix")}`;
}

/**
 * Small colored dot that reflects the real-time sync connection status.
 * Clicking opens a popover with sync details and a "Sync Now" button.
 * Hidden when status is null (sync not available).
 */
export function SyncIndicator({
  status,
  lastSyncAt,
  syncHistory,
  isManualSyncing,
  onTriggerSync,
}: SyncIndicatorProps) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  if (!status) return null;

  const config = STATUS_CONFIG[status];

  return (
    <div className="relative" ref={popoverRef}>
      <button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        className="flex items-center focus:outline-none"
        aria-label={t(config.labelKey)}
        aria-expanded={isOpen}
        data-testid="sync-indicator-button"
      >
        <span
          className={`w-2 h-2 rounded-full ${config.color} ${
            config.pulse ? "animate-pulse" : ""
          }`}
        />
      </button>

      {isOpen && (
        <div
          className="absolute bottom-full right-0 mb-2 z-50 w-64 bg-card border border-border rounded-lg shadow-xl text-sm"
          data-testid="sync-popover"
        >
          {/* Header */}
          <div className="px-3 py-2 border-b border-border">
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${config.color} ${
                  config.pulse ? "animate-pulse" : ""
                }`}
              />
              <span className="text-foreground font-medium text-xs">
                {t(config.labelKey)}
              </span>
            </div>
            {lastSyncAt && (
              <p className="text-xs text-muted-foreground mt-1">
                {t("sync.lastSyncPrefix")} {formatRelativeTime(lastSyncAt, t)}
              </p>
            )}
          </div>

          {/* Sync history */}
          <div className="max-h-40 overflow-y-auto px-3 py-2">
            {syncHistory.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                {t("sync.noEvents")}
              </p>
            ) : (
              <ul className="space-y-1" data-testid="sync-history-list">
                {syncHistory.map((event, i) => (
                  <li
                    key={`${event.timestamp}-${i}`}
                    className="flex items-center justify-between text-xs"
                  >
                    <span
                      className={
                        event.type === "sync_error"
                          ? "text-red-400"
                          : "text-foreground"
                      }
                    >
                      {event.type === "sync_complete"
                        ? `${t("sync.event.syncedPrefix")} ${(event as Record<string, unknown>).changedCount ?? 0} ${t("sync.event.items")}`
                        : event.type === "sync_error"
                          ? `${t("sync.event.errorPrefix")} ${(event as Record<string, unknown>).message ?? t("sync.event.unknown")}`
                          : event.type}
                    </span>
                    <span className="text-muted-foreground ml-2 shrink-0">
                      {formatRelativeTime(event.timestamp, t)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Sync Now button */}
          <div className="px-3 py-2 border-t border-border">
            <button
              type="button"
              onClick={onTriggerSync}
              disabled={isManualSyncing || status === "disconnected"}
              className="w-full px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1.5"
              data-testid="sync-now-button"
            >
              {isManualSyncing ? (
                <>
                  <span className="w-3 h-3 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                  {t("sync.status.connecting")}
                </>
              ) : (
                t("sync.syncNow")
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

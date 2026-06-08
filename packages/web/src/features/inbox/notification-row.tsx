import { Icon } from "@/components/ui/icons";
import type { NotificationDashboardItem } from "@kanon/bridge";

const KIND_LABELS: Record<NotificationDashboardItem["kind"], string> = {
  mention: "Mentioned you",
  assignment: "Assigned to you",
  subscribed_activity: "Update on subscribed issue",
  cycle_closed: "Cycle closed",
};

export interface NotificationRowProps {
  notification: NotificationDashboardItem;
  onMarkRead: (id: string) => void;
}

export function NotificationRow({ notification, onMarkRead }: NotificationRowProps) {
  const label = KIND_LABELS[notification.kind];
  const isUnread = !notification.read;

  return (
    <div
      data-testid="notification-row"
      data-read={notification.read}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "7px 10px",
        borderRadius: 4,
        background: isUnread ? "var(--bg-2)" : "transparent",
        position: "relative",
      }}
    >
      {/* Unread dot */}
      {isUnread && (
        <span
          data-testid="unread-dot"
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "var(--accent)",
            flexShrink: 0,
          }}
        />
      )}
      {!isUnread && <span style={{ width: 6, flexShrink: 0 }} />}

      <Icon.Bell style={{ flexShrink: 0, color: "var(--ink-3)" }} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 12.5,
            fontWeight: isUnread ? 500 : 400,
            color: "var(--ink)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </div>
        <div
          className="mono"
          style={{ fontSize: 10.5, color: "var(--ink-4)", marginTop: 1 }}
        >
          {new Date(notification.createdAt).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}
        </div>
      </div>

      {isUnread && (
        <button
          type="button"
          data-testid="mark-read-btn"
          onClick={() => onMarkRead(notification.id)}
          title="Mark as read"
          style={{
            padding: "2px 6px",
            fontSize: 10.5,
            color: "var(--ink-3)",
            borderRadius: 3,
            cursor: "pointer",
            flexShrink: 0,
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "var(--bg-3)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "transparent")
          }
        >
          Mark read
        </button>
      )}
    </div>
  );
}

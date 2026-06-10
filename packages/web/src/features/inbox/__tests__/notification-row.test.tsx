/**
 * Tests for NotificationRow component and the Notifications section in InboxView.
 *
 * Covers:
 * - NotificationRow renders unread state (unread dot, bold text, mark-read button)
 * - NotificationRow renders read state (no unread dot, no mark-read button)
 * - NotificationRow empty state in InboxView shows "No notifications."
 * - NotificationRow calls onMarkRead with correct id on button click
 * - InboxView Notifications section shows unread count badge and Mark all read button
 * - InboxView Notifications section hides badge/button when all read
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { NotificationRow } from "../notification-row";
import type { NotificationDashboardItem } from "@kanon/shared";

// Controlled mock for useNotificationsQuery — overridden per test below
const mockNotificationsQueryResult: {
  data: NotificationDashboardItem[] | undefined;
  isError: boolean;
} = { data: [], isError: false };

vi.mock("../use-notifications-query", () => ({
  useNotificationsQuery: () => mockNotificationsQueryResult,
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────

const NOTIF_UNREAD: NotificationDashboardItem = {
  id: "notif-1",
  kind: "mention",
  issueId: "issue-uuid-1",
  actorId: "actor-uuid-1",
  mentionId: "mention-uuid-1",
  payload: null,
  read: false,
  via: null,
  createdAt: "2026-06-01T10:00:00.000Z",
};

const NOTIF_READ: NotificationDashboardItem = {
  id: "notif-2",
  kind: "assignment",
  issueId: "issue-uuid-2",
  actorId: "actor-uuid-2",
  mentionId: null,
  payload: null,
  read: true,
  via: null,
  createdAt: "2026-06-02T10:00:00.000Z",
};

// ─── NotificationRow unit tests ───────────────────────────────────────────────

describe("NotificationRow", () => {
  it("renders unread state: unread dot + mark-read button visible", () => {
    const onMarkRead = vi.fn();
    render(<NotificationRow notification={NOTIF_UNREAD} onMarkRead={onMarkRead} />);

    expect(screen.getByTestId("unread-dot")).toBeTruthy();
    expect(screen.getByTestId("mark-read-btn")).toBeTruthy();
    expect(screen.getByText("Mentioned you")).toBeTruthy();
  });

  it("renders read state: no unread dot, no mark-read button", () => {
    const onMarkRead = vi.fn();
    render(<NotificationRow notification={NOTIF_READ} onMarkRead={onMarkRead} />);

    expect(screen.queryByTestId("unread-dot")).toBeNull();
    expect(screen.queryByTestId("mark-read-btn")).toBeNull();
    expect(screen.getByText("Assigned to you")).toBeTruthy();
  });

  it("calls onMarkRead with notification id when mark-read button is clicked", () => {
    const onMarkRead = vi.fn();
    render(<NotificationRow notification={NOTIF_UNREAD} onMarkRead={onMarkRead} />);

    const btn = screen.getByTestId("mark-read-btn");
    fireEvent.click(btn);

    expect(onMarkRead).toHaveBeenCalledOnce();
    expect(onMarkRead).toHaveBeenCalledWith("notif-1");
  });

  it("data-read attribute reflects notification.read value", () => {
    const { rerender } = render(
      <NotificationRow notification={NOTIF_UNREAD} onMarkRead={vi.fn()} />,
    );
    const row = screen.getByTestId("notification-row");
    expect(row.getAttribute("data-read")).toBe("false");

    rerender(<NotificationRow notification={NOTIF_READ} onMarkRead={vi.fn()} />);
    expect(row.getAttribute("data-read")).toBe("true");
  });

  it("isMarkingRead=true: button is disabled and does not fire onMarkRead on click", () => {
    const onMarkRead = vi.fn();
    render(
      <NotificationRow
        notification={NOTIF_UNREAD}
        onMarkRead={onMarkRead}
        isMarkingRead={true}
      />,
    );

    const btn = screen.getByTestId("mark-read-btn") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);

    // Clicking a disabled button must not invoke onMarkRead
    fireEvent.click(btn);
    expect(onMarkRead).not.toHaveBeenCalled();
  });

  it("isMarkingRead=false (default): button is enabled and fires onMarkRead on click", () => {
    const onMarkRead = vi.fn();
    render(
      <NotificationRow
        notification={NOTIF_UNREAD}
        onMarkRead={onMarkRead}
        isMarkingRead={false}
      />,
    );

    const btn = screen.getByTestId("mark-read-btn") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);

    fireEvent.click(btn);
    expect(onMarkRead).toHaveBeenCalledOnce();
    expect(onMarkRead).toHaveBeenCalledWith("notif-1");
  });
});

// ─── InboxView Notifications section tests ────────────────────────────────────

vi.mock("@/hooks/use-workspace-query", () => ({
  useActiveWorkspaceId: () => "ws-test-123",
}));

vi.mock("@/stores/auth-store", () => ({
  useAuthStore: (selector: (s: { user: { displayName: string } }) => unknown) =>
    selector({ user: { displayName: "Alice" } }),
}));

vi.mock("@/stores/command-palette-store", () => ({
  useCommandPaletteStore: (selector: (s: { open: () => void }) => unknown) =>
    selector({ open: vi.fn() }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  fetchApi: vi.fn().mockResolvedValue({ notifications: [] }),
}));

vi.mock("@/hooks/use-projects-query", () => ({
  useProjectsQuery: () => ({ data: [] }),
}));

vi.mock("@/stores/toast-store", () => ({
  useToastStore: {
    getState: () => ({ addToast: vi.fn() }),
  },
}));

const DASHBOARD_EMPTY = {
  counts: { openIssues: 0, inProgress: 0, awaitingReview: 0, activeAgents: 0 },
  assigned: [],
  mentions: [],
  proposals: [],
  agents: [],
  activeCycle: null,
  multipleActiveProjects: false,
  notifications: [],
  unreadCount: 0,
};

function createWrapper(
  dashboardData: unknown,
  notificationsData: NotificationDashboardItem[],
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(["dashboard", "detail", "ws-test-123"], dashboardData);
  // Seed notifications query (notificationKeys.list("ws-test-123"))
  queryClient.setQueryData(
    ["notifications", "list", "ws-test-123"],
    notificationsData,
  );
  // Sync the module-level mock so useNotificationsQuery returns the same data.
  // (InboxView reads from the mock, not directly from the cache.)
  mockNotificationsQueryResult.data = notificationsData;
  mockNotificationsQueryResult.isError = false;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe("InboxView — Notifications section", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset notifications query mock to default (success + empty list)
    mockNotificationsQueryResult.data = [];
    mockNotificationsQueryResult.isError = false;
  });

  it("empty state: shows 'No notifications.' when list is empty", async () => {
    const { wrapper } = createWrapper(DASHBOARD_EMPTY, []);
    const { InboxView } = await import("../inbox-view");
    render(<InboxView />, { wrapper });

    expect(screen.getByText("No notifications.")).toBeTruthy();
  });

  it("shows unread count badge and Mark all read button when unread exist", async () => {
    const { wrapper } = createWrapper(DASHBOARD_EMPTY, [NOTIF_UNREAD]);
    const { InboxView } = await import("../inbox-view");
    render(<InboxView />, { wrapper });

    // Unread count hint: "1 unread"
    expect(screen.getByText("1 unread")).toBeTruthy();
    // Mark all read button
    expect(screen.getByTestId("mark-all-read-btn")).toBeTruthy();
    // NotificationRow rendered
    expect(screen.getAllByTestId("notification-row")).toHaveLength(1);
  });

  it("hides Mark all read button when all notifications are read", async () => {
    const { wrapper } = createWrapper(DASHBOARD_EMPTY, [NOTIF_READ]);
    const { InboxView } = await import("../inbox-view");
    render(<InboxView />, { wrapper });

    expect(screen.queryByTestId("mark-all-read-btn")).toBeNull();
    // No unread hint
    expect(screen.queryByText(/\d+ unread/)).toBeNull();
    // Row still rendered (read state)
    expect(screen.getAllByTestId("notification-row")).toHaveLength(1);
  });

  it("renders one row per notification in correct read/unread state", async () => {
    const { wrapper } = createWrapper(DASHBOARD_EMPTY, [NOTIF_UNREAD, NOTIF_READ]);
    const { InboxView } = await import("../inbox-view");
    render(<InboxView />, { wrapper });

    const rows = screen.getAllByTestId("notification-row");
    expect(rows).toHaveLength(2);

    // First row: unread
    expect(rows[0]!.getAttribute("data-read")).toBe("false");
    // Second row: read
    expect(rows[1]!.getAttribute("data-read")).toBe("true");
    expect(screen.getByText("1 unread")).toBeTruthy();
  });

  it("error state: shows 'Failed to load notifications.' instead of empty hint when query errors", async () => {
    const { wrapper } = createWrapper(DASHBOARD_EMPTY, []);

    // Force useNotificationsQuery to signal an error AFTER createWrapper resets the mock.
    mockNotificationsQueryResult.data = undefined;
    mockNotificationsQueryResult.isError = true;

    const { InboxView } = await import("../inbox-view");
    render(<InboxView />, { wrapper });

    // Must show distinct error message, NOT the normal empty state
    expect(screen.getByText("Failed to load notifications.")).toBeTruthy();
    expect(screen.queryByText("No notifications.")).toBeNull();
    expect(screen.queryByTestId("notification-row")).toBeNull();
  });
});

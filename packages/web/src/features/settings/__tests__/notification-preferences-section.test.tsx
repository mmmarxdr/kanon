/**
 * Tests for NotificationPreferencesSection.
 *
 * Covers:
 * - Renders 3 toggle rows (Mentions, Assignments, Cycle closed).
 * - Toggling a row calls the mutation with the full updated prefs object.
 * - Loading state renders a loading message.
 * - Error state renders an error message.
 * - Each toggle exposes an accessible name matching its row label (KAN-212 Slice A).
 *
 * Pattern: mock hooks, render component, assert DOM state and mutation calls.
 * Mirrors members-section.test.tsx harness structure.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { NotificationPreferenceItem } from "@kanon/shared";

// Mock the hooks the component depends on
vi.mock("../use-notification-preferences-query", () => ({
  useNotificationPreferencesQuery: vi.fn(),
}));

vi.mock("../use-update-notification-preferences-mutation", () => ({
  useUpdateNotificationPreferencesMutation: vi.fn(),
}));

const WORKSPACE_ID = "ws-test-123";

const DEFAULT_PREFS: NotificationPreferenceItem = {
  emailMention: true,
  emailAssignment: true,
  emailCycleClosed: true,
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

async function renderSection(opts: {
  data?: NotificationPreferenceItem | undefined;
  isLoading?: boolean;
  error?: Error | null;
  mutateFn?: ReturnType<typeof vi.fn>;
}) {
  const {
    useNotificationPreferencesQuery,
  } = await import("../use-notification-preferences-query");

  const {
    useUpdateNotificationPreferencesMutation,
  } = await import("../use-update-notification-preferences-mutation");

  const mutateFn = opts.mutateFn ?? vi.fn();

  vi.mocked(useNotificationPreferencesQuery).mockReturnValue({
    data: opts.data,
    isLoading: opts.isLoading ?? false,
    error: opts.error ?? null,
  } as unknown as ReturnType<typeof useNotificationPreferencesQuery>);

  vi.mocked(useUpdateNotificationPreferencesMutation).mockReturnValue({
    mutate: mutateFn,
    isPending: false,
  } as unknown as ReturnType<typeof useUpdateNotificationPreferencesMutation>);

  const { NotificationPreferencesSection } = await import(
    "../notification-preferences-section"
  );

  const wrapper = createWrapper();
  render(
    <NotificationPreferencesSection workspaceId={WORKSPACE_ID} />,
    { wrapper },
  );

  return { mutateFn };
}

describe("NotificationPreferencesSection — list layout (KAN-213 Slice B)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders toggles inside SettingsList rows without a column header row", async () => {
    await renderSection({ data: DEFAULT_PREFS });

    expect(screen.queryByTestId("settings-list-header")).not.toBeInTheDocument();
    const mentionRow = screen.getByTestId("toggle-emailMention").closest('[role="row"]');
    expect(mentionRow).toHaveStyle({ minHeight: "48px" });
  });

  it("passes workspaceId to preference hooks for workspace scoping", async () => {
    await renderSection({ data: DEFAULT_PREFS });

    const { useNotificationPreferencesQuery } = await import(
      "../use-notification-preferences-query"
    );
    const { useUpdateNotificationPreferencesMutation } = await import(
      "../use-update-notification-preferences-mutation"
    );

    expect(useNotificationPreferencesQuery).toHaveBeenCalledWith(WORKSPACE_ID);
    expect(useUpdateNotificationPreferencesMutation).toHaveBeenCalledWith(WORKSPACE_ID);
  });
});

describe("NotificationPreferencesSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders 3 toggle rows: Mentions, Assignments, Cycle closed", async () => {
    await renderSection({ data: DEFAULT_PREFS });

    expect(screen.getByText("Mentions")).toBeInTheDocument();
    expect(screen.getByText("Assignments")).toBeInTheDocument();
    expect(screen.getByText("Cycle closed")).toBeInTheDocument();
  });

  it("toggling emailMention calls mutation with full updated object", async () => {
    const { mutateFn } = await renderSection({ data: DEFAULT_PREFS });

    const mentionToggle = screen.getByTestId("toggle-emailMention");
    fireEvent.click(mentionToggle);

    expect(mutateFn).toHaveBeenCalledWith({
      emailMention: false,
      emailAssignment: true,
      emailCycleClosed: true,
    });
  });

  it("toggling emailAssignment calls mutation with full updated object", async () => {
    const { mutateFn } = await renderSection({ data: DEFAULT_PREFS });

    const toggle = screen.getByTestId("toggle-emailAssignment");
    fireEvent.click(toggle);

    expect(mutateFn).toHaveBeenCalledWith({
      emailMention: true,
      emailAssignment: false,
      emailCycleClosed: true,
    });
  });

  it("toggling emailCycleClosed calls mutation with full updated object", async () => {
    const { mutateFn } = await renderSection({ data: DEFAULT_PREFS });

    const toggle = screen.getByTestId("toggle-emailCycleClosed");
    fireEvent.click(toggle);

    expect(mutateFn).toHaveBeenCalledWith({
      emailMention: true,
      emailAssignment: true,
      emailCycleClosed: false,
    });
  });

  it("renders loading state when isLoading is true", async () => {
    await renderSection({ isLoading: true, data: undefined });
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("renders error state when error is present", async () => {
    await renderSection({ error: new Error("fetch failed"), data: undefined });
    expect(screen.getByText(/failed/i)).toBeInTheDocument();
  });

  it("each toggle has an aria-label matching its row label", async () => {
    await renderSection({ data: DEFAULT_PREFS });

    expect(screen.getByTestId("toggle-emailMention")).toHaveAttribute(
      "aria-label",
      "Mentions",
    );
    expect(screen.getByTestId("toggle-emailAssignment")).toHaveAttribute(
      "aria-label",
      "Assignments",
    );
    expect(screen.getByTestId("toggle-emailCycleClosed")).toHaveAttribute(
      "aria-label",
      "Cycle closed",
    );
  });
});

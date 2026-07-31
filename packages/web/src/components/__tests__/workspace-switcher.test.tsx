import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WorkspaceSwitcher } from "../workspace-switcher";

const navigateMock = vi.fn();
const setActiveMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("@/hooks/use-workspace-query", () => ({
  useWorkspacesQuery: () => ({
    data: [
      {
        id: "ws-a",
        name: "Alpha",
        slug: "alpha",
        allowedDomains: [],
        createdAt: "2026-01-01T00:00:00Z",
      },
      {
        id: "ws-b",
        name: "Beta",
        slug: "beta",
        allowedDomains: [],
        createdAt: "2026-02-01T00:00:00Z",
      },
    ],
  }),
  useActiveWorkspaceId: () => "ws-a",
  useSetActiveWorkspace: () => setActiveMock,
}));

vi.mock("@/components/ui/icons", () => ({
  Monogram: () => <span data-testid="monogram">K</span>,
  Icon: {
    ChevD: () => <span>v</span>,
  },
}));

describe("WorkspaceSwitcher", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    setActiveMock.mockReset();
  });

  it("shows the active workspace name", () => {
    render(<WorkspaceSwitcher />);
    expect(screen.getByTestId("workspace-switcher")).toHaveTextContent("Alpha");
  });

  it("lists workspaces and switches to another with navigation to inbox", () => {
    render(<WorkspaceSwitcher />);
    fireEvent.click(screen.getByTestId("workspace-switcher"));
    expect(screen.getByTestId("workspace-switcher-menu")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("workspace-switcher-item-beta"));
    expect(setActiveMock).toHaveBeenCalledWith("ws-b");
    expect(navigateMock).toHaveBeenCalledWith({ to: "/inbox" });
  });

  it("manage action navigates to /workspaces without changing active id", () => {
    render(<WorkspaceSwitcher />);
    fireEvent.click(screen.getByTestId("workspace-switcher"));
    fireEvent.click(screen.getByTestId("workspace-switcher-manage"));
    expect(navigateMock).toHaveBeenCalledWith({ to: "/workspaces" });
    expect(setActiveMock).not.toHaveBeenCalled();
  });
});

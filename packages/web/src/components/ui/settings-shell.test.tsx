/**
 * SettingsShell layout primitive (KAN-213 Slice A).
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsShell } from "./settings-shell";

const TABS = [
  { key: "members", label: "Members" },
  { key: "invites", label: "Invites" },
] as const;

describe("SettingsShell (KAN-213 Slice A)", () => {
  it("renders title and eyebrow in the header", () => {
    render(
      <SettingsShell title="Acme Corp" eyebrow="workspace settings">
        <p>Body content</p>
      </SettingsShell>,
    );

    expect(screen.getByRole("heading", { name: "Acme Corp" })).toBeInTheDocument();
    expect(screen.getByText("workspace settings")).toBeInTheDocument();
    expect(screen.getByText("Body content")).toBeInTheDocument();
  });

  it("applies default max-width min(1100px, 100%) on the inner content column", () => {
    render(
      <SettingsShell title="Settings">
        <p>Default width</p>
      </SettingsShell>,
    );

    const column = screen.getByText("Default width").parentElement;
    expect(column).toHaveStyle({ maxWidth: "min(1100px, 100%)" });
  });

  it("applies wide max-width min(1200px, 100%) when maxWidth is wide", () => {
    render(
      <SettingsShell title="Settings" maxWidth="wide">
        <p>Wide content</p>
      </SettingsShell>,
    );

    const column = screen.getByText("Wide content").parentElement;
    expect(column).toHaveStyle({ maxWidth: "min(1200px, 100%)" });
  });

  it("uses full available width on narrow viewports without horizontal overflow", () => {
    render(
      <SettingsShell title="Settings">
        <p>Narrow viewport</p>
      </SettingsShell>,
    );

    const column = screen.getByText("Narrow viewport").parentElement;
    expect(column).toHaveStyle({ maxWidth: "min(1100px, 100%)" });
    expect(column).toHaveStyle({ width: "100%" });
  });

  it("renders TabList and tabpanel attrs when tabs and tabPanel are provided", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <SettingsShell
        title="Workspace"
        tabs={{
          idPrefix: "settings",
          tabs: [...TABS],
          activeKey: "members",
          onChange,
        }}
        tabPanel={{
          id: "settings-panel-members",
          ariaLabelledBy: "settings-tab-members",
        }}
      >
        <div data-testid="panel-body">Members panel</div>
      </SettingsShell>,
    );

    const membersTab = screen.getByRole("tab", { name: "Members" });
    const panel = screen.getByRole("tabpanel");

    expect(membersTab).toHaveAttribute("id", "settings-tab-members");
    expect(membersTab).toHaveAttribute("aria-controls", "settings-panel-members");
    expect(panel).toHaveAttribute("id", "settings-panel-members");
    expect(panel).toHaveAttribute("aria-labelledby", "settings-tab-members");
    expect(screen.getByTestId("panel-body")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Invites" }));
    expect(onChange).toHaveBeenCalledWith("invites");
  });
});

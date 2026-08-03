/**
 * SettingsCard shell primitive (KAN-212 Slice D).
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SettingsCard } from "./settings-card";

describe("SettingsCard (KAN-212 Slice D)", () => {
  it("renders children inside a section shell", () => {
    render(
      <SettingsCard>
        <p>Members list</p>
      </SettingsCard>,
    );

    const shell = screen.getByText("Members list").closest("section");
    expect(shell).toBeInTheDocument();
    expect(shell).toHaveClass("rounded-lg", "border", "border-border", "bg-card", "p-5", "sm:p-6");
  });

  it("merges optional className onto the base shell classes", () => {
    render(
      <SettingsCard className="mt-4 extra-class">
        <span>Content</span>
      </SettingsCard>,
    );

    const shell = screen.getByText("Content").closest("section");
    expect(shell).toHaveClass("p-5", "sm:p-6", "mt-4", "extra-class");
  });

  it("maps testId to data-testid on the section", () => {
    render(
      <SettingsCard testId="admin-redmine-section">
        <span>Admin panel</span>
      </SettingsCard>,
    );

    expect(screen.getByTestId("admin-redmine-section")).toBeInTheDocument();
    expect(screen.getByTestId("admin-redmine-section").tagName).toBe("SECTION");
  });
});

describe("SettingsCard v2 (KAN-213 Slice C)", () => {
  it("renders title, description, and actions in a structured header", () => {
    render(
      <SettingsCard
        title="Members"
        description="Manage workspace access"
        actions={<button type="button">Invite</button>}
      >
        <p>List body</p>
      </SettingsCard>,
    );

    expect(screen.getByRole("heading", { name: "Members" })).toBeInTheDocument();
    expect(screen.getByText("Manage workspace access")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Invite" })).toBeInTheDocument();
    expect(screen.getByText("List body")).toBeInTheDocument();
  });

  it("renders actions-only header without a title placeholder gap", () => {
    render(
      <SettingsCard actions={<button type="button">Add</button>}>
        <span>Body</span>
      </SettingsCard>,
    );

    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("applies insetList styling to body while header keeps card padding", () => {
    render(
      <SettingsCard title="Members" insetList>
        <div data-testid="list-region">Rows</div>
      </SettingsCard>,
    );

    const listRegion = screen.getByTestId("list-region");
    const insetWrapper = listRegion.parentElement;
    expect(insetWrapper).toHaveClass("bg-secondary/20", "-mx-5", "sm:-mx-6");
    expect(screen.getByRole("heading", { name: "Members" }).closest("div")).not.toHaveClass(
      "bg-secondary/20",
    );
  });

  it("keeps standard body padding when insetList is unset", () => {
    render(
      <SettingsCard title="Profile">
        <input aria-label="Name" />
      </SettingsCard>,
    );

    const input = screen.getByRole("textbox", { name: "Name" });
    expect(input.parentElement).not.toHaveClass("bg-secondary/20");
  });
});

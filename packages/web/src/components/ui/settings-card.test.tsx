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

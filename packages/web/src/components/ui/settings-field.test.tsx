/**
 * SettingsField form primitive (KAN-213 Slice C).
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SettingsField } from "./settings-field";

describe("SettingsField (KAN-213 Slice C)", () => {
  it("associates label with control via htmlFor", () => {
    render(
      <SettingsField label="Instance name" htmlFor="instanceName">
        <input id="instanceName" data-testid="instance-name-input" />
      </SettingsField>,
    );

    const label = screen.getByText("Instance name");
    expect(label).toHaveAttribute("for", "instanceName");
    expect(screen.getByTestId("instance-name-input")).toHaveAttribute("id", "instanceName");
  });

  it("renders optional hint below the label", () => {
    render(
      <SettingsField
        label="Allowed domains"
        htmlFor="allowedDomains"
        hint="Comma-separated, leave empty to allow all"
      >
        <input id="allowedDomains" />
      </SettingsField>,
    );

    expect(screen.getByText("Comma-separated, leave empty to allow all")).toBeInTheDocument();
  });

  it("applies full-width span on md grid", () => {
    render(
      <SettingsField label="Instance name" htmlFor="instanceName" span="full">
        <input id="instanceName" />
      </SettingsField>,
    );

    expect(screen.getByText("Instance name").closest("div")).toHaveClass("md:col-span-2");
  });

  it("defaults to half-width column span", () => {
    render(
      <SettingsField label="Signup mode" htmlFor="signupMode">
        <select id="signupMode" />
      </SettingsField>,
    );

    const field = screen.getByText("Signup mode").closest("div");
    expect(field).not.toHaveClass("md:col-span-2");
  });
});

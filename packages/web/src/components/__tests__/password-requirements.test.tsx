import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PasswordRequirements } from "../password-requirements";
import type { Requirement } from "@/lib/password-policy";

describe("PasswordRequirements", () => {
  it("renders the container with aria-live=polite and data-testid", () => {
    render(<PasswordRequirements requirements={[]} />);
    const container = screen.getByTestId("password-requirements");
    expect(container).toBeDefined();
    expect(container.getAttribute("aria-live")).toBe("polite");
  });

  it("container is present in the DOM even when requirements is empty", () => {
    render(<PasswordRequirements requirements={[]} />);
    const container = screen.getByTestId("password-requirements");
    expect(container).toBeDefined();
    // No requirement items rendered
    const items = container.querySelectorAll("[data-testid^='requirement-']");
    expect(items).toHaveLength(0);
  });

  it("renders one item per requirement", () => {
    const requirements: Requirement[] = [
      { id: "min-length", label: "At least 8 characters", met: true },
      { id: "match", label: "Passwords match", met: false },
    ];
    render(<PasswordRequirements requirements={requirements} />);
    const items = screen
      .getByTestId("password-requirements")
      .querySelectorAll("[data-testid^='requirement-']");
    expect(items).toHaveLength(2);
  });

  it("each item has data-met matching the met field", () => {
    const requirements: Requirement[] = [
      { id: "min-length", label: "At least 8 characters", met: true },
      { id: "match", label: "Passwords match", met: false },
    ];
    render(<PasswordRequirements requirements={requirements} />);
    const minItem = screen.getByTestId("requirement-min-length");
    const matchItem = screen.getByTestId("requirement-match");
    expect(minItem.getAttribute("data-met")).toBe("true");
    expect(matchItem.getAttribute("data-met")).toBe("false");
  });

  it("does NOT render max-length item when it is met", () => {
    const requirements: Requirement[] = [
      { id: "min-length", label: "At least 8 characters", met: true },
      { id: "max-length", label: "At most 128 characters", met: true },
      { id: "match", label: "Passwords match", met: true },
    ];
    render(<PasswordRequirements requirements={requirements} />);
    const maxItem = screen.queryByTestId("requirement-max-length");
    expect(maxItem).toBeNull();
  });

  it("DOES render max-length item when it is unmet (violated)", () => {
    const requirements: Requirement[] = [
      { id: "min-length", label: "At least 8 characters", met: true },
      { id: "max-length", label: "At most 128 characters", met: false },
      { id: "match", label: "Passwords match", met: true },
    ];
    render(<PasswordRequirements requirements={requirements} />);
    const maxItem = screen.getByTestId("requirement-max-length");
    expect(maxItem).toBeDefined();
    expect(maxItem.getAttribute("data-met")).toBe("false");
  });
});

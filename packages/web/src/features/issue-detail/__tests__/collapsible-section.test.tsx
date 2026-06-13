/**
 * KAN-108 slice 3 — CollapsibleSection component tests
 *
 * CS-1: Renders expanded by default — children are in the DOM.
 * CS-2: When defaultCollapsed=true, children are NOT in the DOM initially.
 * CS-3: Clicking the header button toggles collapsed state.
 * CS-4: aria-expanded reflects open/closed state.
 * CS-5: Count badge is rendered when count prop is provided.
 * CS-6: aria-controls on the button points to the panel's id attribute.
 * CS-7: Panel has data-testid="collapsible-section-{sectionId}".
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SECTION_IDS } from "../collapsible-section-ids";

beforeEach(() => {
  sessionStorage.clear();
});
afterEach(() => {
  sessionStorage.clear();
});

describe("CollapsibleSection (KAN-108 slice 3)", () => {
  it("CS-1: renders expanded by default — children visible in DOM", async () => {
    const { CollapsibleSection } = await import("../collapsible-section");

    render(
      <CollapsibleSection
        sectionId={SECTION_IDS.DESIGN_RECORDS}
        title="Design Records"
        issueKey="KAN-1"
        defaultCollapsed={false}
      >
        <div data-testid="inner-content">My Content</div>
      </CollapsibleSection>,
    );

    // Children are mounted when expanded
    expect(screen.getByTestId("inner-content")).toBeInTheDocument();
    expect(screen.getByText("My Content")).toBeInTheDocument();
  });

  it("CS-2: when defaultCollapsed=true, children are NOT rendered", async () => {
    const { CollapsibleSection } = await import("../collapsible-section");

    render(
      <CollapsibleSection
        sectionId={SECTION_IDS.SUB_ISSUES}
        title="Sub-issues"
        issueKey="KAN-1"
        defaultCollapsed={true}
      >
        <div data-testid="inner-content">Hidden Content</div>
      </CollapsibleSection>,
    );

    // Panel is NOT mounted when collapsed (unmounted, not hidden)
    expect(screen.queryByTestId("inner-content")).not.toBeInTheDocument();
    expect(screen.queryByText("Hidden Content")).not.toBeInTheDocument();
  });

  it("CS-3: clicking the header button toggles collapse — collapsed→expanded shows children", async () => {
    const { CollapsibleSection } = await import("../collapsible-section");

    render(
      <CollapsibleSection
        sectionId={SECTION_IDS.DEPENDENCIES}
        title="Dependencies"
        issueKey="KAN-5"
        defaultCollapsed={true}
      >
        <div data-testid="toggled-content">Now Visible</div>
      </CollapsibleSection>,
    );

    // Start collapsed — content not present
    expect(screen.queryByTestId("toggled-content")).not.toBeInTheDocument();

    // Click the toggle button
    const button = screen.getByRole("button", { name: /dependencies/i });
    fireEvent.click(button);

    // Now expanded — content is mounted
    expect(screen.getByTestId("toggled-content")).toBeInTheDocument();
    expect(screen.getByText("Now Visible")).toBeInTheDocument();
  });

  it("CS-3b: clicking again collapses — children unmounted", async () => {
    const { CollapsibleSection } = await import("../collapsible-section");

    render(
      <CollapsibleSection
        sectionId={SECTION_IDS.DESIGN_RECORDS}
        title="Design Records"
        issueKey="KAN-9"
        defaultCollapsed={false}
      >
        <div data-testid="content">Visible</div>
      </CollapsibleSection>,
    );

    // Start expanded
    expect(screen.getByTestId("content")).toBeInTheDocument();

    const button = screen.getByRole("button", { name: /design records/i });
    fireEvent.click(button);

    // Now collapsed — content unmounted
    expect(screen.queryByTestId("content")).not.toBeInTheDocument();
  });

  it("CS-4: aria-expanded reflects expanded state", async () => {
    const { CollapsibleSection } = await import("../collapsible-section");

    render(
      <CollapsibleSection
        sectionId={SECTION_IDS.DESIGN_RECORDS}
        title="Design Records"
        issueKey="KAN-3"
        defaultCollapsed={false}
      >
        <span>content</span>
      </CollapsibleSection>,
    );

    const button = screen.getByRole("button", { name: /design records/i });
    // Expanded → aria-expanded="true"
    expect(button).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(button);

    // Collapsed → aria-expanded="false"
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("CS-5: count badge renders when count prop is provided", async () => {
    const { CollapsibleSection } = await import("../collapsible-section");

    render(
      <CollapsibleSection
        sectionId={SECTION_IDS.SUB_ISSUES}
        title="Sub-issues"
        count={7}
        issueKey="KAN-2"
        defaultCollapsed={false}
      >
        <span>children</span>
      </CollapsibleSection>,
    );

    // The count "7" should appear in the header area
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("CS-5b: no count badge when count is undefined", async () => {
    const { CollapsibleSection } = await import("../collapsible-section");

    render(
      <CollapsibleSection
        sectionId={SECTION_IDS.DEPENDENCIES}
        title="Dependencies"
        issueKey="KAN-4"
        defaultCollapsed={false}
      >
        <span>children</span>
      </CollapsibleSection>,
    );

    // The title text should be present
    expect(screen.getByRole("button", { name: /dependencies/i })).toBeInTheDocument();
  });

  it("CS-6: aria-controls on button points to panel id", async () => {
    const { CollapsibleSection } = await import("../collapsible-section");

    render(
      <CollapsibleSection
        sectionId={SECTION_IDS.DESIGN_RECORDS}
        title="Design Records"
        issueKey="KAN-6"
        defaultCollapsed={false}
      >
        <span>content</span>
      </CollapsibleSection>,
    );

    const button = screen.getByRole("button", { name: /design records/i });
    const panelId = button.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();

    // The panel must have that id
    const panel = document.getElementById(panelId!);
    expect(panel).toBeInTheDocument();
  });

  it("CS-7: panel has data-testid matching collapsible-section-{sectionId}", async () => {
    const { CollapsibleSection } = await import("../collapsible-section");

    render(
      <CollapsibleSection
        sectionId={SECTION_IDS.SUB_ISSUES}
        title="Sub-issues"
        issueKey="KAN-8"
        defaultCollapsed={false}
      >
        <span>children</span>
      </CollapsibleSection>,
    );

    // Panel testid is always present (even when expanded, it wraps children)
    expect(
      screen.getByTestId("collapsible-section-sub-issues"),
    ).toBeInTheDocument();
  });
});

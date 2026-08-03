/**
 * TabList accessible tabs primitive (KAN-212 Slice C).
 *
 * Covers WAI-ARIA tablist semantics, roving tabindex, and keyboard navigation.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { TabList } from "./primitives";

const TABS = [
  { key: "alpha" as const, label: "Alpha" },
  { key: "beta" as const, label: "Beta" },
  { key: "gamma" as const, label: "Gamma" },
];

function TabListHarness({ initialKey = "alpha" }: { initialKey?: "alpha" | "beta" | "gamma" }) {
  const [activeKey, setActiveKey] = useState(initialKey);
  return (
    <TabList
      tabs={TABS}
      activeKey={activeKey}
      onChange={setActiveKey}
      idPrefix="demo"
    />
  );
}

describe("TabList — accessible tab semantics (KAN-212 Slice C)", () => {
  it("renders tablist with tabs that expose aria roles, ids, and controls", () => {
    render(<TabListHarness initialKey="beta" />);

    expect(screen.getByRole("tablist")).toBeInTheDocument();

    const alpha = screen.getByRole("tab", { name: "Alpha" });
    const beta = screen.getByRole("tab", { name: "Beta" });
    const gamma = screen.getByRole("tab", { name: "Gamma" });

    expect(screen.getAllByRole("tab")).toHaveLength(3);

    expect(alpha).toHaveAttribute("id", "demo-tab-alpha");
    expect(alpha).toHaveAttribute("aria-controls", "demo-panel-alpha");
    expect(alpha).toHaveAttribute("aria-selected", "false");
    expect(alpha).toHaveAttribute("tabindex", "-1");

    expect(beta).toHaveAttribute("id", "demo-tab-beta");
    expect(beta).toHaveAttribute("aria-controls", "demo-panel-beta");
    expect(beta).toHaveAttribute("aria-selected", "true");
    expect(beta).toHaveAttribute("tabindex", "0");

    expect(gamma).toHaveAttribute("id", "demo-tab-gamma");
    expect(gamma).toHaveAttribute("aria-controls", "demo-panel-gamma");
    expect(gamma).toHaveAttribute("aria-selected", "false");
    expect(gamma).toHaveAttribute("tabindex", "-1");
  });

  it("moves focus and selection on Right arrow with roving tabindex", async () => {
    const user = userEvent.setup();
    render(<TabListHarness initialKey="alpha" />);

    const alpha = screen.getByRole("tab", { name: "Alpha" });
    const beta = screen.getByRole("tab", { name: "Beta" });

    alpha.focus();
    expect(alpha).toHaveFocus();

    await user.keyboard("{ArrowRight}");

    expect(beta).toHaveFocus();
    expect(beta).toHaveAttribute("tabindex", "0");
    expect(alpha).toHaveAttribute("tabindex", "-1");
    expect(beta).toHaveAttribute("aria-selected", "true");
    expect(alpha).toHaveAttribute("aria-selected", "false");
  });

  it("jumps to first tab on Home and last tab on End", async () => {
    const user = userEvent.setup();
    render(<TabListHarness initialKey="beta" />);

    const alpha = screen.getByRole("tab", { name: "Alpha" });
    const beta = screen.getByRole("tab", { name: "Beta" });
    const gamma = screen.getByRole("tab", { name: "Gamma" });

    beta.focus();

    await user.keyboard("{End}");
    expect(gamma).toHaveFocus();
    expect(gamma).toHaveAttribute("aria-selected", "true");
    expect(beta).toHaveAttribute("aria-selected", "false");

    await user.keyboard("{Home}");
    expect(alpha).toHaveFocus();
    expect(alpha).toHaveAttribute("aria-selected", "true");
    expect(gamma).toHaveAttribute("aria-selected", "false");
  });
});

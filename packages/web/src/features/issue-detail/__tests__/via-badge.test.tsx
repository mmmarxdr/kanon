/**
 * KAN-32 — ViaBadge unit tests (Strict TDD — RED first).
 *
 * Scenarios from spec.md § 2.5 and acceptance scenarios 2-5, 14.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ViaBadge } from "../via-badge";

describe("ViaBadge — Scenario 2: via=claude-code → 'Claude Code' cobalt badge", () => {
  it("renders 'Claude Code' label when via='claude-code'", () => {
    render(<ViaBadge via="claude-code" />);
    expect(screen.getByText("Claude Code")).toBeDefined();
  });
});

describe("ViaBadge — Scenario 3: recognized tool labels", () => {
  it.each([
    ["cursor", "Cursor"],
    ["antigravity", "Antigravity"],
    ["cli", "CLI"],
  ] as const)("via=%s renders label %s", (via, label) => {
    render(<ViaBadge via={via} />);
    expect(screen.getByText(label)).toBeDefined();
  });
});

describe("ViaBadge — Scenario 4: via='web' → renders nothing", () => {
  it("renders nothing when via='web'", () => {
    const { container } = render(<ViaBadge via="web" />);
    expect(container.firstChild).toBeNull();
  });
});

describe("ViaBadge — Scenario 5: via=null → renders nothing", () => {
  it("renders nothing when via=null", () => {
    const { container } = render(<ViaBadge via={null} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("ViaBadge — Scenario 14: unknown via value → renders nothing", () => {
  it("renders nothing for unrecognized via values", () => {
    const { container } = render(<ViaBadge via="some-future-tool" />);
    expect(container.firstChild).toBeNull();
  });
});

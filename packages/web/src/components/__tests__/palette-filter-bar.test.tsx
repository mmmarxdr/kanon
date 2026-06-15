/**
 * PaletteFilterBar — KAN-111 PR2b unit tests.
 *
 * Verifies:
 *  - Renders State, Type, Priority chips
 *  - Each chip's onChange calls setFilterToken and pushes the new raw string up
 *  - Clearing a chip (empty value) removes the token from raw
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PaletteFilterBar } from "@/components/palette-filter-bar";

// Mock FilterChipSelect — tracks calls so we can test onChange wiring
vi.mock("@/components/ui/primitives", () => ({
  FilterChipSelect: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    options: { value: string; label: string }[];
    onChange: (v: string) => void;
    allLabel?: string;
  }) => (
    <div>
      <span data-testid={`chip-label-${label.toLowerCase()}`}>{label}</span>
      <span data-testid={`chip-value-${label.toLowerCase()}`}>{value}</span>
      <button
        data-testid={`chip-select-${label.toLowerCase()}`}
        onClick={() => onChange("feature")}
      >
        select feature
      </button>
      <button
        data-testid={`chip-clear-${label.toLowerCase()}`}
        onClick={() => onChange("")}
      >
        clear
      </button>
    </div>
  ),
}));

function renderBar(raw: string, onRawChange: (r: string) => void): ReturnType<typeof render> {
  return render(<PaletteFilterBar raw={raw} onRawChange={onRawChange} />);
}

describe("PaletteFilterBar", () => {
  it("renders State, Type, and Priority chips", () => {
    renderBar("", vi.fn());

    expect(screen.getByTestId("chip-label-state")).toBeInTheDocument();
    expect(screen.getByTestId("chip-label-type")).toBeInTheDocument();
    expect(screen.getByTestId("chip-label-priority")).toBeInTheDocument();
  });

  it("derives chip value from raw string (state:done → state chip shows 'done')", () => {
    renderBar("state:done", vi.fn());

    expect(screen.getByTestId("chip-value-state")).toHaveTextContent("done");
  });

  it("derives type chip value from raw string", () => {
    renderBar("type:bug", vi.fn());

    expect(screen.getByTestId("chip-value-type")).toHaveTextContent("bug");
  });

  it("chip onChange calls onRawChange with updated raw string (select feature → 'type:feature')", () => {
    const onRawChange = vi.fn();
    renderBar("", onRawChange);

    fireEvent.click(screen.getByTestId("chip-select-type"));

    expect(onRawChange).toHaveBeenCalledOnce();
    const newRaw = onRawChange.mock.calls[0]?.[0] as string;
    expect(newRaw).toContain("type:feature");
  });

  it("clearing a chip removes the token from raw", () => {
    const onRawChange = vi.fn();
    renderBar("type:bug some text", onRawChange);

    fireEvent.click(screen.getByTestId("chip-clear-type"));

    expect(onRawChange).toHaveBeenCalledOnce();
    const newRaw = onRawChange.mock.calls[0]?.[0] as string;
    expect(newRaw).not.toContain("type:");
    expect(newRaw).toContain("some text");
  });

  it("selecting state chip writes through to raw string", () => {
    const onRawChange = vi.fn();
    renderBar("auth module", onRawChange);

    fireEvent.click(screen.getByTestId("chip-select-state"));

    const newRaw = onRawChange.mock.calls[0]?.[0] as string;
    expect(newRaw).toContain("state:");
    expect(newRaw).toContain("auth module");
  });

  it("priority chip onChange writes priority token", () => {
    const onRawChange = vi.fn();
    renderBar("", onRawChange);

    fireEvent.click(screen.getByTestId("chip-select-priority"));

    const newRaw = onRawChange.mock.calls[0]?.[0] as string;
    expect(newRaw).toContain("priority:");
  });
});

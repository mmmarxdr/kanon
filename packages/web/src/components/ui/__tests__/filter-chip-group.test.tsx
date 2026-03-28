import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FilterChipGroup } from "@/components/ui/filter-chip-group";

const OPTIONS = [
  { label: "Idea", value: "idea" },
  { label: "Planned", value: "planned" },
  { label: "In Progress", value: "in_progress" },
  { label: "Done", value: "done" },
];

describe("FilterChipGroup", () => {
  it("renders all options plus an 'All' chip", () => {
    render(
      <FilterChipGroup value={undefined} onChange={vi.fn()} options={OPTIONS} />,
    );

    expect(screen.getByText("All")).toBeDefined();
    expect(screen.getByText("Idea")).toBeDefined();
    expect(screen.getByText("Planned")).toBeDefined();
    expect(screen.getByText("In Progress")).toBeDefined();
    expect(screen.getByText("Done")).toBeDefined();
  });

  it("calls onChange with the option value when a chip is clicked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(
      <FilterChipGroup value={undefined} onChange={onChange} options={OPTIONS} />,
    );

    await user.click(screen.getByText("Planned"));
    expect(onChange).toHaveBeenCalledWith("planned");
  });

  it("calls onChange with undefined when 'All' chip is clicked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(
      <FilterChipGroup value="planned" onChange={onChange} options={OPTIONS} />,
    );

    await user.click(screen.getByText("All"));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("toggles off the active chip (calls onChange with undefined)", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(
      <FilterChipGroup value="planned" onChange={onChange} options={OPTIONS} />,
    );

    // Clicking the already-active chip should deselect
    await user.click(screen.getByText("Planned"));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("uses custom allLabel", () => {
    render(
      <FilterChipGroup
        value={undefined}
        onChange={vi.fn()}
        options={OPTIONS}
        allLabel="Show all"
      />,
    );

    expect(screen.getByText("Show all")).toBeDefined();
  });
});

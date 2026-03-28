import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FilterSelect } from "@/components/ui/filter-select";

const OPTIONS = [
  { label: "Now", value: "now" },
  { label: "Next", value: "next" },
  { label: "Later", value: "later" },
];

describe("FilterSelect", () => {
  it("renders with 'All' as the first option by default", () => {
    render(<FilterSelect value="" onChange={vi.fn()} options={OPTIONS} />);

    const options = screen.getAllByRole("option");
    expect(options[0]?.textContent).toBe("All");
    expect((options[0] as HTMLOptionElement | undefined)?.value).toBe("");
  });

  it("uses custom allLabel when provided", () => {
    render(
      <FilterSelect
        value=""
        onChange={vi.fn()}
        options={OPTIONS}
        allLabel="All horizons"
      />,
    );

    const options = screen.getAllByRole("option");
    expect(options[0]?.textContent).toBe("All horizons");
  });

  it("calls onChange with selected value", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(<FilterSelect value="" onChange={onChange} options={OPTIONS} />);

    const select = screen.getByRole("combobox");
    await user.selectOptions(select, "now");

    expect(onChange).toHaveBeenCalledWith("now");
  });

  it("calls onChange with empty string when selecting 'All'", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(<FilterSelect value="now" onChange={onChange} options={OPTIONS} />);

    const select = screen.getByRole("combobox");
    await user.selectOptions(select, "");

    expect(onChange).toHaveBeenCalledWith("");
  });
});

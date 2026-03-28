import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchInput } from "@/components/ui/search-input";

describe("SearchInput", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders with placeholder text", () => {
    render(<SearchInput value="" onChange={vi.fn()} placeholder="Search..." />);
    expect(screen.getByPlaceholderText("Search...")).toBeDefined();
  });

  it("calls onChange after 300ms debounce when typing", async () => {
    const onChange = vi.fn();

    render(<SearchInput value="" onChange={onChange} placeholder="Search..." />);

    const input = screen.getByPlaceholderText("Search...") as HTMLInputElement;

    // Simulate typing by changing the value and firing input event
    await act(() => {
      // Manually set value and dispatch event to avoid userEvent timer conflicts
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "hello");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // onChange should not have been called yet
    expect(onChange).not.toHaveBeenCalledWith("hello");

    // Advance past debounce delay
    await act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(onChange).toHaveBeenCalledWith("hello");
  });

  it("shows clear button when value is non-empty", () => {
    render(<SearchInput value="test" onChange={vi.fn()} />);
    const clearBtn = screen.getByRole("button", { name: /clear search/i });
    expect(clearBtn).toBeDefined();
  });

  it("hides clear button when value is empty", () => {
    render(<SearchInput value="" onChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /clear search/i })).toBeNull();
  });

  it("calls onChange immediately with empty string when clear is clicked", async () => {
    const onChange = vi.fn();

    render(<SearchInput value="test" onChange={onChange} />);

    const clearBtn = screen.getByRole("button", { name: /clear search/i });

    await act(() => {
      clearBtn.click();
    });

    // Clear fires immediately, no debounce
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("syncs internal value when external value prop changes", () => {
    const { rerender } = render(
      <SearchInput value="old" onChange={vi.fn()} placeholder="Search..." />,
    );

    const input = screen.getByPlaceholderText("Search...") as HTMLInputElement;
    expect(input.value).toBe("old");

    rerender(<SearchInput value="new" onChange={vi.fn()} placeholder="Search..." />);
    expect(input.value).toBe("new");
  });
});

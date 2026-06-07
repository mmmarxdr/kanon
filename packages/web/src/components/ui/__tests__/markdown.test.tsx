import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "@/components/ui/markdown";

describe("Markdown", () => {
  it("renders heading markdown as an h2 element", () => {
    render(<Markdown>{"## Heading"}</Markdown>);
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).toBeDefined();
    expect(heading.textContent).toBe("Heading");
  });

  it("renders an h1 element for # heading", () => {
    render(<Markdown>{"# Top Level"}</Markdown>);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toBeDefined();
    expect(heading.textContent).toBe("Top Level");
  });

  it("wraps the output in a div with markdown-body class", () => {
    const { container } = render(<Markdown>{"hello"}</Markdown>);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("markdown-body");
  });

  it("merges additional className onto the wrapper", () => {
    const { container } = render(
      <Markdown className="text-sm">{"hello"}</Markdown>,
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("markdown-body");
    expect(wrapper.className).toContain("text-sm");
  });

  it("wraps table in an overflow-x container", () => {
    const tableMarkdown =
      "| A | B |\n|---|---|\n| 1 | 2 |";
    const { container } = render(<Markdown>{tableMarkdown}</Markdown>);
    const tableWrapper = container.querySelector("div[style]");
    expect(tableWrapper).not.toBeNull();
    const table = container.querySelector("table");
    expect(table).not.toBeNull();
  });
});

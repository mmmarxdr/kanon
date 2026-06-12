import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "@/components/ui/markdown";

// MermaidBlock is lazy-loaded; stub the whole module so these tests are
// synchronous and don't need mermaid itself in jsdom.
vi.mock("@/components/ui/mermaid-block", () => ({
  MermaidBlock: ({ chart }: { chart: string }) => (
    <div data-testid="mermaid-block" data-chart={chart} />
  ),
}));

describe("Markdown — mermaid block detection", () => {
  it("renders a MermaidBlock for a ```mermaid fenced code block", () => {
    const md = "```mermaid\ngraph TD; A-->B\n```";
    render(<Markdown>{md}</Markdown>);
    const block = screen.getByTestId("mermaid-block");
    expect(block).toBeDefined();
    expect(block.getAttribute("data-chart")).toContain("graph TD");
  });

  it("renders plain code block for non-mermaid language", () => {
    const md = "```typescript\nconst x = 1;\n```";
    const { container } = render(<Markdown>{md}</Markdown>);
    expect(screen.queryByTestId("mermaid-block")).toBeNull();
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code?.textContent).toContain("const x = 1");
  });

  it("renders plain code block when no language is specified", () => {
    const md = "```\nsome text\n```";
    const { container } = render(<Markdown>{md}</Markdown>);
    expect(screen.queryByTestId("mermaid-block")).toBeNull();
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
  });
});

describe("Markdown — code block overflow", () => {
  it("wraps code blocks in a pre element (for CSS overflow-x: auto)", () => {
    const md = "```\nsome long content that should not wrap\n```";
    const { container } = render(<Markdown>{md}</Markdown>);
    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
  });

  it("renders inline code without a pre wrapper", () => {
    const md = "some `inline code` here";
    const { container } = render(<Markdown>{md}</Markdown>);
    const pres = container.querySelectorAll("pre");
    expect(pres.length).toBe(0);
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
  });
});

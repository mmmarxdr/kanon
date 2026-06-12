import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MermaidBlock } from "@/components/ui/mermaid-block";

// Mock the mermaid library — it's ~500 KB and not available in jsdom
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: "<svg>diagram</svg>" }),
  },
}));

describe("MermaidBlock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // This test must run first so it captures the once-only initialize() call.
  // The module-level guard ensures initialize() is called exactly once per module
  // instance; subsequent renders in the same suite skip it.
  it("initializes mermaid with securityLevel antiscript to prevent XSS from click directives", async () => {
    const mermaid = await import("mermaid");
    // Chart containing a click directive — a common XSS vector in user-controlled mermaid source
    const xssChart =
      'graph TD; A-->B; click A href "javascript:alert(1)" "xss"';
    render(<MermaidBlock chart={xssChart} />);
    await waitFor(() => {
      expect(mermaid.default.initialize).toHaveBeenCalledWith(
        expect.objectContaining({ securityLevel: "antiscript" }),
      );
    });
  });

  it("renders a container div with the mermaid class", async () => {
    const { container } = render(
      <MermaidBlock chart="graph TD; A-->B" />,
    );
    await waitFor(() => {
      const wrapper = container.querySelector(".mermaid-diagram");
      expect(wrapper).not.toBeNull();
    });
  });

  it("calls mermaid.render with the provided chart source", async () => {
    const mermaid = await import("mermaid");
    render(<MermaidBlock chart="sequenceDiagram; A->>B: Hello" />);
    await waitFor(() => {
      expect(mermaid.default.render).toHaveBeenCalledWith(
        expect.stringContaining("mermaid-"),
        "sequenceDiagram; A->>B: Hello",
      );
    });
  });

  it("falls back to a plain <pre> code block on render error", async () => {
    const mermaid = await import("mermaid");
    vi.mocked(mermaid.default.render).mockRejectedValueOnce(
      new Error("invalid mermaid syntax"),
    );

    const { container } = render(<MermaidBlock chart="invalid syntax %%%" />);

    await waitFor(() => {
      // getByRole("code") is not a valid ARIA role — use querySelector instead
      const code = container.querySelector("pre code");
      expect(code).not.toBeNull();
    });
  });

  it("fallback pre contains the original chart source on error", async () => {
    const mermaid = await import("mermaid");
    vi.mocked(mermaid.default.render).mockRejectedValueOnce(
      new Error("invalid"),
    );

    const { container } = render(
      <MermaidBlock chart="bad diagram" />,
    );

    await waitFor(() => {
      const pre = container.querySelector("pre");
      expect(pre).not.toBeNull();
      expect(pre?.textContent).toContain("bad diagram");
    });
  });
});

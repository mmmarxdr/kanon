import { useEffect, useId, useRef, useState } from "react";

interface MermaidBlockProps {
  chart: string;
}

/**
 * Renders a mermaid diagram by lazy-loading the mermaid library only when a
 * ```mermaid block is present in the page. Falls back to a plain <pre> code
 * block if the chart source is invalid or mermaid fails to render.
 *
 * The lazy import (~500 KB) is intentionally inside this component so it is
 * never included in the main bundle.
 */

// Module-level once-guard: mermaid.initialize() operates on a global singleton
// and must only be called once regardless of how many MermaidBlock instances render.
let mermaidInitialized = false;

export function MermaidBlock({ chart }: MermaidBlockProps) {
  const id = useId().replace(/:/g, "-");
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Derive diagramId inside the effect so it is stable per-render and
    // not included in the dependency array (avoids spurious re-runs).
    const diagramId = `mermaid-${id}`;

    async function renderDiagram() {
      try {
        const mermaid = (await import("mermaid")).default;
        if (!mermaidInitialized) {
          mermaid.initialize({
            startOnLoad: false,
            // theme: "dark" — hardcoded until the app exposes a theme-toggle API
            theme: "dark",
            // "antiscript" strips event handlers and script hrefs from user-controlled
            // source while keeping inline SVG rendering (unlike "strict" which sandboxes
            // into an iframe and breaks layout).
            securityLevel: "antiscript",
          });
          mermaidInitialized = true;
        }
        const { svg: rendered } = await mermaid.render(diagramId, chart);
        if (!cancelled) {
          setSvg(rendered);
        }
      } catch {
        if (!cancelled) {
          setFailed(true);
        }
      }
    }

    void renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [chart, id]);

  if (failed) {
    return (
      <pre>
        <code>{chart}</code>
      </pre>
    );
  }

  return (
    <div
      ref={containerRef}
      className="mermaid-diagram"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted mermaid SVG output
      dangerouslySetInnerHTML={svg != null ? { __html: svg } : undefined}
    />
  );
}

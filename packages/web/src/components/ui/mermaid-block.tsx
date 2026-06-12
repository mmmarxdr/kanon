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
export function MermaidBlock({ chart }: MermaidBlockProps) {
  const id = useId().replace(/:/g, "-");
  const diagramId = `mermaid-${id}`;
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function renderDiagram() {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          securityLevel: "loose",
        });
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
  }, [chart, diagramId]);

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

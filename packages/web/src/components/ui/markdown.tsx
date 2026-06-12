import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MermaidBlock } from "@/components/ui/mermaid-block";

interface MarkdownProps {
  children: string;
  className?: string;
}

/**
 * Shared markdown renderer.
 *
 * Wraps react-markdown + remark-gfm inside a `.markdown-body` div so all
 * render sites get consistent heading, list, blockquote, and table styles
 * defined in index.css. The table components override is moved here from
 * issue.tsx so every site inherits overflow-x scrolling on wide tables.
 *
 * Mermaid fenced code blocks (```mermaid) are rendered as diagrams via
 * MermaidBlock, which lazy-loads the mermaid library (~500 KB) only when
 * needed so it never enters the main bundle. Any other fenced or inline code
 * block is rendered as a normal <pre><code> with horizontal scroll.
 */
export function Markdown({ children, className }: MarkdownProps) {
  return (
    <div className={"markdown-body " + (className ?? "")}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Render mermaid fenced blocks as diagrams; everything else as-is.
          code({ className: codeClassName, children: codeChildren, ...rest }) {
            const language = /language-(\w+)/.exec(codeClassName ?? "")?.[1];
            if (language === "mermaid") {
              const source = String(codeChildren).replace(/\n$/, "");
              return <MermaidBlock chart={source} />;
            }
            return (
              <code className={codeClassName} {...rest}>
                {codeChildren}
              </code>
            );
          },
          table: ({ node: _node, ...props }) => (
            <div style={{ overflowX: "auto", maxWidth: "100%" }}>
              <table {...props} />
            </div>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

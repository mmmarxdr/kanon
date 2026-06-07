import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
 */
export function Markdown({ children, className }: MarkdownProps) {
  return (
    <div className={"markdown-body " + (className ?? "")}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
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

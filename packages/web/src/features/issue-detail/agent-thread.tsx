import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Comment } from "@/types/issue";
import { Icon } from "@/components/ui/icons";
import { Kbd } from "@/components/ui/primitives";

interface AgentThreadProps {
  comments: Comment[];
  isLoading: boolean;
}

const AGENT_SOURCES = new Set(["mcp", "engram_sync", "system"]);

export function AgentThread({ comments, isLoading }: AgentThreadProps) {
  const agentComments = comments.filter((c) => AGENT_SOURCES.has(c.source));

  if (isLoading) {
    return (
      <div
        style={{
          padding: "24px 0",
          textAlign: "center",
          fontSize: 12,
          color: "var(--ink-3)",
        }}
      >
        Loading agent thread…
      </div>
    );
  }

  return (
    <div
      style={{
        background: "var(--bg-2)",
        border: "1px solid var(--line)",
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "10px 14px",
          borderBottom: "1px solid var(--line)",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span
          style={{
            width: 18,
            height: 18,
            borderRadius: 3,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--ai)",
            color: "var(--btn-ink)",
          }}
        >
          <Icon.Spark />
        </span>
        <span style={{ fontSize: 12, fontWeight: 500 }}>Agent thread</span>
        <span style={{ flex: 1 }} />
        <span
          className="mono"
          style={{ fontSize: 10, color: "var(--ink-4)" }}
        >
          {agentComments.length} message{agentComments.length === 1 ? "" : "s"}
        </span>
      </div>

      <div
        style={{
          padding: "12px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          maxHeight: 460,
          overflow: "auto",
        }}
      >
        {agentComments.length === 0 ? (
          <div
            style={{
              fontSize: 12,
              color: "var(--ink-4)",
              fontStyle: "italic",
              padding: "8px 0",
            }}
          >
            No agent activity on this issue yet. When an MCP agent (Claude,
            Codex, etc.) acts on this issue its messages will appear here.
          </div>
        ) : (
          agentComments.map((c) => (
            <AgentMessage key={c.id} comment={c} />
          ))
        )}
      </div>

      <div
        style={{
          padding: "10px 14px",
          borderTop: "1px solid var(--line)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 10px",
            border: "1px solid var(--line)",
            borderRadius: 5,
            background: "var(--panel)",
            opacity: 0.7,
          }}
          title="Direct prompts to agents arrive in Phase 3"
        >
          <Icon.Spark style={{ color: "var(--ai)" }} />
          <input
            placeholder="Direct the agent… (coming soon)"
            disabled
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              background: "transparent",
              fontSize: 12,
              fontFamily: "Inter Tight",
              color: "var(--ink-3)",
            }}
          />
          <Kbd>⌘↵</Kbd>
        </div>
      </div>
    </div>
  );
}

function AgentMessage({ comment }: { comment: Comment }) {
  const isSync = comment.source === "engram_sync";
  return (
    <div
      style={{
        background: isSync
          ? "color-mix(in oklch, var(--ok) 12%, transparent)"
          : "var(--ai-2)",
        border: `1px solid ${
          isSync
            ? "color-mix(in oklch, var(--ok) 32%, transparent)"
            : "color-mix(in oklch, var(--ai) 22%, transparent)"
        }`,
        borderRadius: 6,
        padding: "8px 10px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 4,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 500,
            color: isSync ? "var(--ok)" : "var(--ai)",
          }}
        >
          {isSync ? "Engram · sync" : comment.author.username || "Agent"}
        </span>
        <span
          className="mono"
          style={{
            fontSize: 10,
            color: "var(--ink-4)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          · {comment.source}
        </span>
        <span style={{ flex: 1 }} />
        <span
          className="mono"
          style={{ fontSize: 10, color: "var(--ink-4)" }}
        >
          {formatRelative(comment.createdAt)}
        </span>
      </div>
      <div
        style={{
          fontSize: 12,
          color: "var(--ink-2)",
          lineHeight: 1.5,
        }}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {comment.body}
        </ReactMarkdown>
      </div>
    </div>
  );
}

function formatRelative(iso: string): string {
  try {
    const date = new Date(iso);
    const diffMs = Date.now() - date.getTime();
    const min = Math.floor(diffMs / 60_000);
    if (min < 1) return "just now";
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `${day}d ago`;
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

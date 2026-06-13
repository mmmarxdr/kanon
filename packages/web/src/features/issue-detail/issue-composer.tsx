import { useState } from "react";
import { Kbd } from "@/components/ui/primitives";

export interface IssueComposerProps {
  onSubmit: (body: string) => void;
  isPending: boolean;
}

/**
 * Comment composer for the issue detail timeline.
 *
 * Owns draft state. Implements ⌘↵ (or Ctrl↵) to submit:
 * trims the draft → calls onSubmit → clears draft.
 *
 * Send button is disabled when draft is empty or submission is pending.
 * No external data-testid in slice 1 — the dock testid lands in slice 2.
 */
export function IssueComposer({ onSubmit, isPending }: IssueComposerProps) {
  const [draft, setDraft] = useState("");

  const handleSubmit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setDraft("");
  };

  return (
    <div
      style={{
        borderTop: "1px solid var(--line)",
        padding: "12px 28px",
        background: "var(--bg)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          padding: "10px 12px",
          border: "1px solid var(--line)",
          borderRadius: 6,
          background: "var(--panel)",
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder="Comment, or @claude to delegate…"
          rows={2}
          style={{
            flex: 1,
            border: "none",
            outline: "none",
            resize: "none",
            background: "transparent",
            fontSize: 12.5,
            lineHeight: 1.5,
            fontFamily: "Inter Tight",
            color: "var(--ink)",
          }}
        />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            alignItems: "flex-end",
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 10,
              color: "var(--ink-4)",
            }}
          >
            <Kbd>⌘</Kbd>
            <Kbd>↵</Kbd>
          </span>
          <button
            type="button"
            disabled={!draft.trim() || isPending}
            onClick={handleSubmit}
            style={{
              height: 26,
              padding: "0 12px",
              fontSize: 11.5,
              fontWeight: 500,
              background: "var(--accent)",
              color: "var(--btn-ink)",
              borderRadius: 4,
              cursor: !draft.trim() || isPending ? "not-allowed" : "pointer",
              opacity: !draft.trim() || isPending ? 0.55 : 1,
            }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

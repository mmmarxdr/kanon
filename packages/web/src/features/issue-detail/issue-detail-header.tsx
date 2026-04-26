import { useState, useRef, useCallback, useEffect } from "react";
import { TypeGlyph, Prio, StatePip } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";

import type { IssueState } from "@/stores/board-store";
import type { IssuePriority, IssueType } from "@/types/issue";

interface IssueDetailHeaderProps {
  issueKey: string;
  title: string;
  type?: IssueType;
  priority?: IssuePriority;
  state?: IssueState;
  hasAgent?: boolean;
  onTitleChange: (newTitle: string) => void;
  onClose: () => void;
}

export function IssueDetailHeader({
  issueKey,
  title,
  type = "task",
  priority = "medium",
  state = "backlog",
  hasAgent = false,
  onTitleChange,
  onClose,
}: IssueDetailHeaderProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditing) {
      setDraft(title);
    }
  }, [title, isEditing]);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const handleSave = useCallback(() => {
    setIsEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== title) {
      onTitleChange(trimmed);
    } else {
      setDraft(title);
    }
  }, [draft, title, onTitleChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSave();
      } else if (e.key === "Escape") {
        e.preventDefault();
        setDraft(title);
        setIsEditing(false);
      }
    },
    [handleSave, title],
  );

  return (
    <div
      style={{
        padding: "20px 28px 14px",
        borderBottom: "1px solid var(--line)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {/* Meta row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <TypeGlyph value={type} />
        <span
          className="mono"
          style={{ fontSize: 12, color: "var(--ink-3)", whiteSpace: "nowrap" }}
        >
          {issueKey}
        </span>
        <span className="mono" style={{ fontSize: 11, color: "var(--ink-4)" }}>
          ·
        </span>
        <StatePip state={state} />
        <span className="mono" style={{ fontSize: 11, color: "var(--ink-4)" }}>
          ·
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            whiteSpace: "nowrap",
          }}
        >
          <Prio value={priority} />
          <span
            className="mono"
            style={{ fontSize: 11, color: "var(--ink-3)" }}
          >
            {priority}
          </span>
        </span>

        <span style={{ flex: 1, minWidth: 8 }} />

        {hasAgent && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              whiteSpace: "nowrap",
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--ai)",
                boxShadow: "0 0 0 3px var(--ai-2)",
                flexShrink: 0,
              }}
            />
            <span
              style={{ fontSize: 11, color: "var(--ai)", fontWeight: 500 }}
            >
              Agent working
            </span>
          </span>
        )}

        <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          style={{
            color: "var(--ink-4)",
            padding: 4,
            marginLeft: 4,
          }}
        >
          <Icon.X />
        </button>
      </div>

      {/* Title — click to edit */}
      {isEditing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={handleSave}
          onKeyDown={handleKeyDown}
          aria-label="Issue title"
          style={{
            width: "100%",
            background: "transparent",
            color: "var(--ink)",
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            lineHeight: 1.2,
            border: "none",
            borderBottom: "2px solid var(--accent)",
            outline: "none",
            padding: "2px 0",
            fontFamily: "Inter Tight",
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          id="issue-detail-title"
          style={{
            display: "block",
            width: "100%",
            textAlign: "left",
            background: "transparent",
            color: "var(--ink)",
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            lineHeight: 1.2,
            cursor: "text",
          }}
        >
          {title}
        </button>
      )}
    </div>
  );
}

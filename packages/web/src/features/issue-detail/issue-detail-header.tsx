import { useState, useRef, useCallback, useEffect } from "react";

interface IssueDetailHeaderProps {
  issueKey: string;
  title: string;
  onTitleChange: (newTitle: string) => void;
  onClose: () => void;
}

/**
 * Header for the issue detail panel.
 * Shows the issue key badge, a click-to-edit title, and a close button.
 *
 * Title editing: renders as text by default. Click to switch to an input.
 * Save on blur or Enter; cancel on Escape (reverts to original).
 */
export function IssueDetailHeader({
  issueKey,
  title,
  onTitleChange,
  onClose,
}: IssueDetailHeaderProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync draft when server title changes (e.g., after optimistic rollback)
  useEffect(() => {
    if (!isEditing) {
      setDraft(title);
    }
  }, [title, isEditing]);

  // Auto-focus input when entering edit mode
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
      // Revert to original if empty or unchanged
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
    <div className="flex items-start gap-3 pr-2">
      {/* Issue key badge */}
      <span className="shrink-0 mt-1 rounded bg-secondary px-2 py-0.5 text-xs font-mono text-muted-foreground">
        {issueKey}
      </span>

      {/* Title — click to edit */}
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            className="w-full bg-transparent text-lg font-semibold text-foreground
              border-b-2 border-primary outline-none px-0 py-0.5
              focus:ring-2 focus:ring-primary/30
              placeholder:text-muted-foreground"
            placeholder="Issue title"
            aria-label="Issue title"
          />
        ) : (
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="w-full text-left text-lg font-semibold text-foreground
              hover:text-primary transition-colors cursor-text
              truncate block"
            id="issue-detail-title"
          >
            {title}
          </button>
        )}
      </div>

      {/* Close button */}
      <button
        type="button"
        onClick={onClose}
        className="shrink-0 mt-0.5 rounded-md p-1.5 text-muted-foreground
          hover:bg-secondary hover:text-foreground transition-colors"
        aria-label="Close panel"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}

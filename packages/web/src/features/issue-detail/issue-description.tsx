import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Markdown } from "@/components/ui/markdown";

export interface IssueDescriptionProps {
  value: string | null | undefined;
  onSave: (next: string) => void;
}

/**
 * Self-contained description editor for an issue.
 *
 * Owns:
 * - isEditing / descriptionDraft / textareaRef state
 * - Two effects: draft sync (when not editing) + textarea focus (when editing)
 *
 * The maxHeight: 240 cap has been removed from the view-mode div.
 * The inner div still scrolls via overflowY/overflowX: auto, so long
 * descriptions scroll within the top zone's independent scroll container
 * rather than being capped at 240px. The top-zone outer-scroll transition
 * (flex:1; minHeight:0; overflowY:auto) completes in slice 2.
 *
 * data-testid="description-section" is on the root for behavior contract continuity.
 */
export function IssueDescription({ value, onSave }: IssueDescriptionProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState(value ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isEditing && value !== undefined) {
      setDescriptionDraft(value ?? "");
    }
  }, [value, isEditing]);

  useEffect(() => {
    if (isEditing) textareaRef.current?.focus();
  }, [isEditing]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || !isEditing) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [descriptionDraft, isEditing]);

  const handleSave = useCallback(() => {
    setIsEditing(false);
    onSave(descriptionDraft);
  }, [descriptionDraft, onSave]);

  return (
    <div data-testid="description-section" style={{ minWidth: 0 }}>
      <div
        style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}
      >
        <span
          className="mono"
          style={{
            fontSize: 10,
            color: "var(--ink-4)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          Description
        </span>
        {isEditing ? (
          <textarea
            ref={textareaRef}
            value={descriptionDraft}
            onChange={(e) => setDescriptionDraft(e.target.value)}
            onBlur={handleSave}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                setDescriptionDraft(value ?? "");
                setIsEditing(false);
              }
            }}
            rows={6}
            placeholder="Add a description (supports Markdown)…"
            aria-label="Issue description"
            style={{
              width: "100%",
              minHeight: 96,
              overflowY: "hidden",
              overflowX: "hidden",
              padding: "10px 12px",
              background: "var(--panel)",
              border: "1px solid var(--line)",
              borderRadius: 6,
              color: "var(--ink)",
              fontSize: 13,
              lineHeight: 1.55,
              outline: "none",
              resize: "none",
              fontFamily: "Inter Tight",
              boxSizing: "border-box",
            }}
          />
        ) : (
          <div
            role="button"
            tabIndex={0}
            onClick={() => setIsEditing(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setIsEditing(true);
              }
            }}
            style={{
              display: "block",
              width: "100%",
              minWidth: 0,
              maxWidth: "100%",
              minHeight: 56,
              // maxHeight: 240 removed — inner div scrolls via overflowY: auto;
              // top-zone outer scroll (flex:1/minHeight:0/overflowY:auto) lands in slice 2.
              overflowY: "visible",
              // "clip" was clipping child <pre> horizontal scroll (ASCII/code-block bug).
              // "auto" lets wide code blocks scroll independently.
              overflowX: "visible",
              padding: "10px 12px",
              background: "var(--panel)",
              border: "1px solid var(--line)",
              borderRadius: 6,
              textAlign: "left",
              cursor: "text",
              boxSizing: "border-box",
              // whiteSpace scoped to non-pre text via CSS cascade; do not set globally
              // here as it would suppress horizontal scroll on <pre> descendants.
              overflowWrap: "anywhere",
              wordBreak: "break-word",
            }}
          >
            {value ? (
              <div
                style={{
                  color: "var(--ink-2)",
                  fontSize: 13,
                  lineHeight: 1.55,
                  overflowWrap: "anywhere",
                  wordBreak: "break-word",
                  minWidth: 0,
                }}
              >
                <Markdown>{value}</Markdown>
              </div>
            ) : (
              <span
                style={{
                  fontSize: 13,
                  color: "var(--ink-4)",
                  fontStyle: "italic",
                }}
              >
                Click to add a description…
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

import { useEffect, useRef, useCallback } from "react";
import { useGroupIssuesQuery } from "./use-issues-query";
import { IssueCard } from "./issue-card";
import { humanizeGroupKey } from "@/lib/humanize-group-key";

interface GroupDrillDownProps {
  projectKey: string;
  groupKey: string;
  onClose: () => void;
  onSelectIssue?: (key: string) => void;
}

/**
 * Right slide-over panel showing all child issues for a group.
 * Reuses IssueCard for each child. Matches the existing IssueDetailPanel
 * pattern with backdrop, slide-in animation, and escape-to-close.
 */
export function GroupDrillDown({
  projectKey,
  groupKey,
  onClose,
  onSelectIssue,
}: GroupDrillDownProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { data: issues, isLoading, error } = useGroupIssuesQuery(projectKey, groupKey);

  // Close on Escape
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const displayTitle = humanizeGroupKey(groupKey);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 z-40 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Group: ${displayTitle}`}
        className="fixed right-0 top-0 bottom-0 w-[28rem] max-w-[90vw] bg-background border-l border-border shadow-xl z-50
          animate-slide-in-right overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex flex-col gap-0.5 min-w-0">
            <h2 className="text-base font-semibold text-foreground truncate">
              {displayTitle}
            </h2>
            <span className="text-xs text-muted-foreground font-mono">
              {groupKey}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-secondary"
            aria-label="Close panel"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="w-5 h-5"
            >
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Loading issues...
            </p>
          )}

          {error && (
            <p className="text-sm text-destructive-foreground py-4 text-center">
              Failed to load issues: {error.message}
            </p>
          )}

          {issues && issues.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No issues in this group.
            </p>
          )}

          {issues && issues.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-xs text-muted-foreground mb-1">
                {issues.length} issue{issues.length === 1 ? "" : "s"}
              </span>
              {issues.map((issue) => (
                <IssueCard
                  key={issue.key}
                  issue={issue}
                  onSelect={onSelectIssue}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

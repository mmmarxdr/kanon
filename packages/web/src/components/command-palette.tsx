import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { issueKeys } from "@/lib/query-keys";
import type { Issue } from "@/types/issue";

interface CommandPaletteProps {
  onClose: () => void;
  onCreateIssue: () => void;
}

interface CommandItem {
  id: string;
  type: "issue" | "action";
  label: string;
  subtitle?: string;
  onSelect: () => void;
}

/**
 * Command Palette component (Cmd+K / Ctrl+K).
 *
 * Provides quick access to:
 * - Issue search (client-side filter of cached issues)
 * - Navigation actions (Board, Backlog, Settings)
 * - Create new issue action
 */
export function CommandPalette({ onClose, onCreateIssue }: CommandPaletteProps) {
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Get cached issues from all project query caches
  const cachedIssues = useMemo(() => {
    const allQueries = queryClient.getQueriesData<Issue[]>({
      queryKey: issueKeys.all,
    });
    const issues: Issue[] = [];
    for (const [, data] of allQueries) {
      if (data) {
        issues.push(...data);
      }
    }
    return issues;
  }, [queryClient]);

  // Build filtered items
  const items = useMemo(() => {
    const result: CommandItem[] = [];
    const query = search.toLowerCase().trim();

    // Filter issues
    const filteredIssues = query
      ? cachedIssues.filter(
          (issue) =>
            issue.title.toLowerCase().includes(query) ||
            issue.key.toLowerCase().includes(query),
        )
      : cachedIssues.slice(0, 5); // Show first 5 when no search

    for (const issue of filteredIssues.slice(0, 10)) {
      result.push({
        id: `issue-${issue.id}`,
        type: "issue",
        label: issue.title,
        subtitle: issue.key,
        onSelect: () => {
          // Navigate to the board with the issue selected
          const projectKey = issue.key.split("-")[0] ?? "";
          void navigate({
            to: "/board/$projectKey",
            params: { projectKey },
            search: { issue: issue.key },
          });
          onClose();
        },
      });
    }

    // Static actions
    const actions: { id: string; label: string; icon: string; onSelect: () => void }[] = [
      {
        id: "create-issue",
        label: "Create new issue",
        icon: "+",
        onSelect: () => {
          onClose();
          onCreateIssue();
        },
      },
      {
        id: "go-board",
        label: "Go to Board",
        icon: "\u25A6",
        onSelect: () => {
          // Navigate to the most recent project board or workspace select
          const firstIssue = cachedIssues[0];
          if (firstIssue) {
            const projectKey = firstIssue.key.split("-")[0] ?? "";
            void navigate({
              to: "/board/$projectKey",
              params: { projectKey },
            });
          }
          onClose();
        },
      },
      {
        id: "go-backlog",
        label: "Go to Backlog",
        icon: "\u2630",
        onSelect: () => {
          onClose();
        },
      },
      {
        id: "go-settings",
        label: "Go to Settings",
        icon: "\u2699",
        onSelect: () => {
          onClose();
        },
      },
    ];

    const filteredActions = query
      ? actions.filter((a) => a.label.toLowerCase().includes(query))
      : actions;

    for (const action of filteredActions) {
      result.push({
        id: action.id,
        type: "action",
        label: action.label,
        subtitle: action.icon,
        onSelect: action.onSelect,
      });
    }

    return result;
  }, [search, cachedIssues, navigate, onClose, onCreateIssue]);

  // Reset selection when items change
  useEffect(() => {
    setSelectedIndex(0);
  }, [items.length, search]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, items.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (items[selectedIndex]) {
            items[selectedIndex].onSelect();
          }
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    },
    [items, selectedIndex, onClose],
  );

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const selected = list.querySelector("[data-selected='true']");
    if (selected) {
      selected.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  // Close on backdrop click
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose],
  );

  // Split items into sections
  const issueItems = items.filter((i) => i.type === "issue");
  const actionItems = items.filter((i) => i.type === "action");

  // Calculate the global index offset for actions
  const actionIndexOffset = issueItems.length;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center animate-fade-in"
      onClick={handleBackdropClick}
      data-testid="command-palette-overlay"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" aria-hidden="true" />

      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        data-testid="command-palette"
        className="relative bg-card rounded-xl shadow-2xl max-w-xl w-full mx-4 mt-[20vh] h-fit animate-command-palette-in"
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center border-b border-border">
          <svg
            className="ml-4 h-4 w-4 text-muted-foreground shrink-0"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Type a command or search..."
            autoFocus
            className="flex-1 bg-transparent text-lg text-foreground placeholder:text-muted-foreground py-3 px-3 focus:outline-none"
            data-testid="command-palette-input"
          />
          <kbd className="mr-4 text-[11px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-80 overflow-y-auto py-2">
          {items.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No results found
            </div>
          ) : (
            <>
              {/* Issues section */}
              {issueItems.length > 0 && (
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground px-4 py-2 font-medium">
                    Issues
                  </div>
                  {issueItems.map((item, i) => (
                    <button
                      key={item.id}
                      type="button"
                      data-selected={selectedIndex === i}
                      onClick={item.onSelect}
                      onMouseEnter={() => setSelectedIndex(i)}
                      className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2 transition-colors ${
                        selectedIndex === i
                          ? "bg-primary/10"
                          : "hover:bg-primary/5"
                      }`}
                    >
                      <span className="text-primary font-mono text-xs shrink-0">
                        {item.subtitle}
                      </span>
                      <span className="text-foreground truncate">{item.label}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Actions section */}
              {actionItems.length > 0 && (
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground px-4 py-2 font-medium">
                    Actions
                  </div>
                  {actionItems.map((item, i) => {
                    const globalIndex = actionIndexOffset + i;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        data-selected={selectedIndex === globalIndex}
                        onClick={item.onSelect}
                        onMouseEnter={() => setSelectedIndex(globalIndex)}
                        className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2 transition-colors ${
                          selectedIndex === globalIndex
                            ? "bg-primary/10"
                            : "hover:bg-primary/5"
                        }`}
                      >
                        <span className="text-muted-foreground text-base w-5 text-center shrink-0">
                          {item.subtitle}
                        </span>
                        <span className="text-foreground">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer hint */}
        <div className="border-t border-border px-4 py-2 flex items-center gap-4 text-[11px] text-muted-foreground">
          <span>
            <kbd className="font-mono bg-muted px-1 py-0.5 rounded mr-1">&uarr;&darr;</kbd>
            Navigate
          </span>
          <span>
            <kbd className="font-mono bg-muted px-1 py-0.5 rounded mr-1">&crarr;</kbd>
            Select
          </span>
          <span>
            <kbd className="font-mono bg-muted px-1 py-0.5 rounded mr-1">Esc</kbd>
            Close
          </span>
        </div>
      </div>
    </div>
  );
}

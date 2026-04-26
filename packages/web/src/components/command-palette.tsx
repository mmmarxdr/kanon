import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { issueKeys } from "@/lib/query-keys";
import type { Issue } from "@/types/issue";
import { useCommandPaletteStore } from "@/stores/command-palette-store";
import { Icon } from "@/components/ui/icons";
import { Kbd, StatePip, TypeGlyph } from "@/components/ui/primitives";


interface CommandPaletteProps {
  onClose: () => void;
  onCreateIssue: () => void;
}

interface CommandItem {
  id: string;
  type: "issue" | "action";
  label: string;
  sub?: string;
  issue?: Issue;
  onSelect: () => void;
}

export function CommandPalette({ onClose, onCreateIssue }: CommandPaletteProps) {
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const mode = useCommandPaletteStore((s) => s.mode);
  const isAI = mode === "ai";

  const cachedIssues = useMemo(() => {
    const allQueries = queryClient.getQueriesData<Issue[]>({
      queryKey: issueKeys.all,
    });
    const issues: Issue[] = [];
    for (const [, data] of allQueries) {
      if (data) issues.push(...data);
    }
    return issues;
  }, [queryClient]);

  const items = useMemo(() => {
    const result: CommandItem[] = [];
    const query = search.toLowerCase().trim();

    if (!isAI) {
      const filteredIssues = query
        ? cachedIssues.filter(
            (issue) =>
              issue.title.toLowerCase().includes(query) ||
              issue.key.toLowerCase().includes(query),
          )
        : cachedIssues.slice(0, 5);

      for (const issue of filteredIssues.slice(0, 10)) {
        result.push({
          id: `issue-${issue.id}`,
          type: "issue",
          label: issue.title,
          sub: issue.key,
          issue,
          onSelect: () => {
            void navigate({
              to: "/issue/$key",
              params: { key: issue.key },
              search: { from: "palette" },
            });
            onClose();
          },
        });
      }
    }

    const actions: { id: string; label: string; sub?: string; onSelect: () => void }[] =
      isAI
        ? [
            { id: "ai-plan", label: "Plan the next cycle", sub: "based on velocity, capacity, and dependency graph", onSelect: onClose },
            { id: "ai-blockers", label: "Find issues blocking the cycle", sub: "scan deps for stuck items", onSelect: onClose },
            { id: "ai-digest", label: "Draft a digest for #standup", sub: "last 24h activity", onSelect: onClose },
          ]
        : [
            {
              id: "create-issue",
              label: "Create new issue",
              sub: "C",
              onSelect: () => {
                onClose();
                onCreateIssue();
              },
            },
            {
              id: "go-board",
              label: "Go to Board",
              sub: "G B",
              onSelect: () => {
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
            { id: "go-inbox",       label: "Go to Inbox",        sub: "G I", onSelect: onClose },
            { id: "go-roadmap",     label: "Go to Roadmap",      sub: "G R", onSelect: onClose },
            { id: "go-dependencies", label: "Go to Dependencies", sub: "G D", onSelect: onClose },
            { id: "go-settings", label: "Go to Settings", sub: "G S", onSelect: onClose },
          ];

    const filteredActions = query
      ? actions.filter((a) => a.label.toLowerCase().includes(query))
      : actions;

    for (const action of filteredActions) {
      result.push({
        id: action.id,
        type: "action",
        label: action.label,
        sub: action.sub,
        onSelect: action.onSelect,
      });
    }

    return result;
  }, [search, cachedIssues, navigate, onClose, onCreateIssue, isAI]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [items.length, search]);

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
          if (items[selectedIndex]) items[selectedIndex].onSelect();
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    },
    [items, selectedIndex, onClose],
  );

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const selected = list.querySelector("[data-selected='true']");
    if (selected) selected.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  const issueItems = items.filter((i) => i.type === "issue");
  const actionItems = items.filter((i) => i.type === "action");
  const actionIndexOffset = issueItems.length;

  return (
    <div
      data-testid="command-palette-overlay"
      onClick={handleBackdropClick}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "color-mix(in oklch, var(--ink) 30%, transparent)",
        backdropFilter: "blur(2px)",
        display: "flex",
        justifyContent: "center",
        paddingTop: "14vh",
        animation: "fade-in 0.15s ease-out",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isAI ? "Ask Kanon" : "Command palette"}
        data-testid="command-palette"
        onKeyDown={handleKeyDown}
        style={{
          width: 620,
          maxWidth: "90vw",
          height: "fit-content",
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: 10,
          boxShadow: "0 24px 60px color-mix(in oklch, black 35%, transparent)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          animation: "command-palette-in 0.15s ease-out",
        }}
      >
        {/* Input */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 14px",
            borderBottom: "1px solid var(--line)",
          }}
        >
          {isAI ? (
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: 4,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: "var(--ai)",
                color: "var(--btn-ink)",
                flexShrink: 0,
              }}
            >
              <Icon.Spark />
            </span>
          ) : (
            <Icon.Search style={{ color: "var(--ink-3)", flexShrink: 0 }} />
          )}
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              isAI
                ? "Ask Kanon to plan, propose, or refactor your roadmap…"
                : "Search issues, run commands…"
            }
            autoFocus
            data-testid="command-palette-input"
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              background: "transparent",
              fontSize: 15,
              fontFamily: "Inter Tight",
              color: "var(--ink)",
            }}
          />
          <Kbd>Esc</Kbd>
        </div>

        {/* Results */}
        <div
          ref={listRef}
          style={{ maxHeight: 420, overflow: "auto", padding: "6px 0 8px" }}
        >
          {items.length === 0 ? (
            <div
              style={{
                padding: "24px 16px",
                textAlign: "center",
                fontSize: 12,
                color: "var(--ink-4)",
              }}
            >
              No results
            </div>
          ) : (
            <>
              {issueItems.length > 0 && (
                <Section label="Issues">
                  {issueItems.map((it, i) => (
                    <Row
                      key={it.id}
                      selected={selectedIndex === i}
                      onSelect={it.onSelect}
                      onHover={() => setSelectedIndex(i)}
                      left={
                        it.issue ? (
                          <TypeGlyph value={it.issue.type} />
                        ) : (
                          <Icon.Search style={{ color: "var(--ink-3)" }} />
                        )
                      }
                      mono={it.sub}
                      title={it.label}
                      right={
                        it.issue ? (
                          <StatePip state={it.issue.state} />
                        ) : null
                      }
                    />
                  ))}
                </Section>
              )}

              {actionItems.length > 0 && (
                <Section label={isAI ? "Suggestions" : "Actions"}>
                  {actionItems.map((it, i) => {
                    const globalIndex = actionIndexOffset + i;
                    return (
                      <Row
                        key={it.id}
                        selected={selectedIndex === globalIndex}
                        onSelect={it.onSelect}
                        onHover={() => setSelectedIndex(globalIndex)}
                        left={isAI ? <Icon.Spark style={{ color: "var(--ai)" }} /> : null}
                        title={it.label}
                        sub={isAI ? it.sub : undefined}
                        right={
                          !isAI && it.sub ? <Kbd>{it.sub}</Kbd> : null
                        }
                        ai={isAI}
                      />
                    );
                  })}
                </Section>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "8px 14px",
            borderTop: "1px solid var(--line)",
            fontSize: 11,
            color: "var(--ink-4)",
          }}
        >
          <span>
            <Kbd>↑↓</Kbd> Navigate
          </span>
          <span>
            <Kbd>↵</Kbd> Select
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: isAI ? "var(--ai)" : "var(--accent)",
              }}
            />
            {isAI ? "Claude · MCP" : "kanon · workspace"}
          </span>
        </div>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        className="mono"
        style={{
          padding: "8px 14px 4px",
          fontSize: 9.5,
          letterSpacing: "0.08em",
          color: "var(--ink-4)",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Row({
  selected,
  onSelect,
  onHover,
  left,
  mono,
  title,
  sub,
  right,
  ai,
}: {
  selected: boolean;
  onSelect: () => void;
  onHover: () => void;
  left?: React.ReactNode;
  mono?: string;
  title: string;
  sub?: string;
  right?: React.ReactNode;
  ai?: boolean;
}) {
  return (
    <button
      type="button"
      data-selected={selected}
      onClick={onSelect}
      onMouseEnter={onHover}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        padding: "8px 14px",
        textAlign: "left",
        background: selected
          ? ai
            ? "var(--ai-2)"
            : "var(--bg-3)"
          : "transparent",
      }}
    >
      {left && (
        <span
          style={{
            color: ai ? "var(--ai)" : "var(--ink-3)",
            display: "inline-flex",
            alignItems: "center",
          }}
        >
          {left}
        </span>
      )}
      {mono && (
        <span
          className="mono"
          style={{ fontSize: 11, color: "var(--ink-3)", width: 64 }}
        >
          {mono}
        </span>
      )}
      <span style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            color: "var(--ink)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </div>
        {sub && (
          <div style={{ fontSize: 11, color: "var(--ink-4)" }}>{sub}</div>
        )}
      </span>
      {right}
    </button>
  );
}

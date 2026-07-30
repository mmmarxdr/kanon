import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useBackdropClose } from "@/hooks/use-backdrop-close";
import { useNavigate } from "@tanstack/react-router";
import type { Issue } from "@/types/issue";
import { useCommandPaletteStore } from "@/stores/command-palette-store";
import { Icon } from "@/components/ui/icons";
import { Kbd, StatePip, TypeGlyph } from "@/components/ui/primitives";
import { PaletteFilterBar } from "@/components/palette-filter-bar";
import { useActiveProjectKey } from "@/hooks/use-active-project-key";
import { useIssueSearchQuery } from "@/features/board/use-issue-search-query";
import { parseSearchTokens } from "@/features/board/parse-search-tokens";

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
  const { t } = useTranslation("palette");
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Single source of truth: raw input → derive q + filters via parseSearchTokens (ADR-4)
  const { q, filters } = useMemo(() => parseSearchTokens(search), [search]);

  const projectKey = useActiveProjectKey();

  // Server-backed issue search — replaces the old cachedIssues/getQueriesData path
  const { data: serverIssues, isFetching } = useIssueSearchQuery(projectKey, q, filters);

  // Memoize so the empty-array fallback keeps a stable identity across renders
  // (serverIssues is undefined while the query is disabled/loading). Without this,
  // `serverIssues ?? []` is a fresh array every render and busts the `items` useMemo
  // below (react-hooks/exhaustive-deps).
  const searchResults = useMemo<Issue[]>(() => serverIssues ?? [], [serverIssues]);

  const items = useMemo(() => {
    const result: CommandItem[] = [];
    const rawQuery = search.toLowerCase().trim();

    // Issue results from server (already filtered server-side)
    for (const issue of searchResults.slice(0, 10)) {
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

    const actions: { id: string; label: string; sub?: string; onSelect: () => void }[] = [
      {
        id: "create-issue",
        label: t("actionCreateIssue"),
        sub: "C",
        onSelect: () => {
          onClose();
          onCreateIssue();
        },
      },
      {
        id: "go-board",
        label: t("actionGoBoard"),
        sub: "G B",
        onSelect: () => {
          if (projectKey) {
            void navigate({
              to: "/board/$projectKey",
              params: { projectKey },
            });
          }
          onClose();
        },
      },
      {
        id: "go-schedule",
        label: t("actionGoSchedule"),
        sub: "G T",
        onSelect: () => {
          if (projectKey) {
            void navigate({
              to: "/schedule/$projectKey",
              params: { projectKey },
            });
          }
          onClose();
        },
      },
      { id: "go-inbox",        label: t("actionGoInbox"),        sub: "G I", onSelect: onClose },
      { id: "go-roadmap",      label: t("actionGoRoadmap"),      sub: "G R", onSelect: onClose },
      { id: "go-dependencies", label: t("actionGoDependencies"), sub: "G D", onSelect: onClose },
      { id: "go-settings",     label: t("actionGoSettings"),     sub: "G S", onSelect: onClose },
    ];

    const filteredActions = rawQuery
      ? actions.filter((a) => a.label.toLowerCase().includes(rawQuery))
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
  }, [search, searchResults, navigate, onClose, onCreateIssue, projectKey, t]);

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

  const handleBackdropClick = useBackdropClose(onClose);

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
        aria-label={t("ariaLabel")}
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
          <Icon.Search style={{ color: "var(--ink-3)", flexShrink: 0 }} />
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("placeholder")}
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
          {isFetching && (
            <span
              role="status"
              data-testid="palette-searching"
              style={{
                fontSize: 11,
                color: "var(--ink-4)",
                fontFamily: "Inter Tight",
                flexShrink: 0,
              }}
            >
              {t("searching")}
            </span>
          )}
          <Kbd>Esc</Kbd>
        </div>

        {/* Filter bar — chips write through the raw input (ADR-4) */}
        <PaletteFilterBar raw={search} onRawChange={setSearch} />

        {/* Results */}
        <div
          ref={listRef}
          style={{ maxHeight: 380, overflow: "auto", padding: "6px 0 8px" }}
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
              {t("noResults")}
            </div>
          ) : (
            <>
              {issueItems.length > 0 && (
                <Section label={t("sectionIssues")}>
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
                          <>
                            {docIndicator(it.issue)}
                            <StatePip state={it.issue.state} />
                          </>
                        ) : null
                      }
                    />
                  ))}
                </Section>
              )}

              {actionItems.length > 0 && (
                <Section label={t("sectionActions")}>
                  {actionItems.map((it, i) => {
                    const globalIndex = actionIndexOffset + i;
                    return (
                      <Row
                        key={it.id}
                        selected={selectedIndex === globalIndex}
                        onSelect={it.onSelect}
                        onHover={() => setSelectedIndex(globalIndex)}
                        left={null}
                        title={it.label}
                        right={it.sub ? <Kbd>{it.sub}</Kbd> : null}
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
            <Kbd>↑↓</Kbd> {t("navigate")}
          </span>
          <span>
            <Kbd>↵</Kbd> {t("select")}
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--accent)",
              }}
            />
            kanon · workspace
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Renders an inline document-kind indicator for an issue row.
 * ADR → "ADR" pill; other kinds → generic doc dot.
 * Returns null when documentKinds is empty or absent.
 */
function docIndicator(issue: Issue): React.ReactNode {
  const kinds = issue.documentKinds;
  if (!kinds || kinds.length === 0) return null;

  const isAdr = kinds.includes("adr");

  return (
    <span
      data-testid={`doc-indicator-${issue.key}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        marginRight: 4,
      }}
    >
      {isAdr ? (
        <span
          style={{
            fontSize: 9,
            fontFamily: "monospace",
            letterSpacing: "0.04em",
            color: "var(--ink-3)",
            background: "var(--bg-3)",
            border: "1px solid var(--line)",
            borderRadius: 3,
            padding: "1px 4px",
            lineHeight: 1.4,
          }}
        >
          ADR
        </span>
      ) : (
        <svg
          width="10"
          height="10"
          viewBox="0 0 16 16"
          fill="none"
          stroke="var(--ink-3)"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-label="has document"
        >
          <rect x="3" y="2" width="10" height="12" rx="1.5" />
          <path d="M6 6h4M6 9h4M6 12h2" />
        </svg>
      )}
    </span>
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
}: {
  selected: boolean;
  onSelect: () => void;
  onHover: () => void;
  left?: React.ReactNode;
  mono?: string;
  title: string;
  sub?: string;
  right?: React.ReactNode;
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
        background: selected ? "var(--bg-3)" : "transparent",
      }}
    >
      {left && (
        <span
          style={{
            color: "var(--ink-3)",
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

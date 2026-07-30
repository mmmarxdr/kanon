import { useState } from "react";
import { useNavigate, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { IssueDocument, DocumentKind } from "@/types/issue";
import { Markdown } from "@/components/ui/markdown";
import i18n from "@/i18n";

interface DocumentListProps {
  documents: IssueDocument[];
  isLoading: boolean;
  issueKey: string;
}

/**
 * Design Records section for the issue detail panel.
 *
 * Collapsed card list with per-card inline expand. Documents are created by
 * agents via MCP (kanon_create_document). Each card shows: kind badge, title,
 * author, date. The card header navigates to the full-page document route
 * /issue/:key/doc/:docId. A separate expand toggle (chevron) reveals the doc
 * body (Markdown + Mermaid) inline without navigating away.
 *
 * KAN-108 slice 4: inline expand preserves the lazy Mermaid load win — the
 * MermaidBlock only mounts when a card is expanded (unmounted on collapse).
 */
export function DocumentList({ documents, isLoading, issueKey }: DocumentListProps) {
  const { t } = useTranslation("issue");

  if (isLoading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "32px 0",
          color: "var(--ink-3)",
          fontSize: 12.5,
        }}
      >
        {t("docsLoading")}
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "40px 0",
          gap: 8,
          color: "var(--ink-3)",
          fontSize: 12.5,
          textAlign: "center",
        }}
      >
        <span style={{ fontSize: 22 }}>📋</span>
        <span>{t("docsEmpty")}</span>
        <span style={{ fontSize: 11.5, color: "var(--ink-4)" }}>
          {t("docsEmptyHint")}
        </span>
      </div>
    );
  }

  return (
    <ul style={{ display: "flex", flexDirection: "column", gap: 8, listStyle: "none", padding: 0, margin: 0 }}>
      {documents.map((doc) => (
        <DocumentCard key={doc.id} document={doc} issueKey={issueKey} />
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/*  Card with inline expand (internal — tests reach it via DocumentList) */
/* ------------------------------------------------------------------ */

interface DocumentCardProps {
  document: IssueDocument;
  issueKey: string;
}

function DocumentCard({ document: doc, issueKey }: DocumentCardProps) {
  const { t } = useTranslation("issue");
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);

  const handleClick = () => {
    void navigate({
      to: "/issue/$key/doc/$docId",
      params: { key: issueKey, docId: doc.id },
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick();
    }
  };

  const handleToggle = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    if ("key" in e && e.key !== "Enter" && e.key !== " ") return;
    setExpanded((prev) => !prev);
  };

  return (
    <li
      style={{
        borderRadius: 6,
        border: "1px solid var(--line)",
        background: "var(--panel)",
        overflow: "hidden",
      }}
    >
      {/* Card header row — clicking navigates to full page */}
      <div
        role="button"
        tabIndex={0}
        data-testid="document-card"
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        aria-label={`${KIND_STYLES[doc.kind].label}: ${doc.title}`}
        style={{
          padding: "10px 14px",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 8,
          transition: "border-color 0.1s",
        }}
      >
        {/* Expand/collapse toggle — stops propagation so it doesn't navigate */}
        <button
          type="button"
          data-testid="document-expand-toggle"
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse design record" : "Expand design record"}
          onClick={handleToggle as React.MouseEventHandler}
          onKeyDown={handleToggle as React.KeyboardEventHandler}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            width: 20,
            height: 20,
            borderRadius: 4,
            color: "var(--ink-3)",
            transition: "transform 0.15s",
            transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
          }}
        >
          {/* Chevron — decorative */}
          <svg
            aria-hidden="true"
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
          >
            <path
              d="M4.5 2.5L8 6L4.5 9.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <KindBadge kind={doc.kind} />

        <span
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: "var(--ink)",
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {doc.title}
        </span>

        <span
          style={{
            fontSize: 11,
            color: "var(--ink-4)",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {doc.author ? `${doc.author.username} · ` : ""}
          {formatRelativeTime(doc.createdAt)}
        </span>
      </div>

      {/* Inline expand panel — only mounted when expanded (Mermaid lazy-load preserved) */}
      {expanded && (
        <div
          data-testid="document-expand-panel"
          style={{
            borderTop: "1px solid var(--line)",
            padding: "12px 14px 16px",
            overflowX: "auto",
            overflowY: "visible",
            maxWidth: "100%",
            boxSizing: "border-box",
            minWidth: 0,
          }}
        >
          <Markdown>{doc.body}</Markdown>

          {/* Secondary "open full page" affordance */}
          <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
            <Link
              to="/issue/$key/doc/$docId"
              params={{ key: issueKey, docId: doc.id }}
              data-testid="document-full-page-link"
              style={{
                fontSize: 11.5,
                color: "var(--accent)",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              Open full page ↗
            </Link>
          </div>
        </div>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/*  Kind badge (exported for testing)                                  */
/* ------------------------------------------------------------------ */

export const KIND_STYLES: Record<DocumentKind, { bg: string; color: string; label: string }> = {
  adr: { bg: "var(--amber-bg, #fef3c7)", color: "var(--amber-fg, #92400e)", label: "ADR" },
  pdr: { bg: "var(--blue-bg, #dbeafe)", color: "var(--blue-fg, #1e40af)", label: "PDR" },
  rfc: { bg: "var(--green-bg, #dcfce7)", color: "var(--green-fg, #166534)", label: "RFC" },
  note: { bg: "var(--bg-2)", color: "var(--ink-3)", label: "NOTE" },
};

export function KindBadge({ kind }: { kind: DocumentKind }) {
  const style = KIND_STYLES[kind];
  return (
    <span
      data-testid={`kind-badge-${kind}`}
      style={{
        fontSize: 10,
        fontWeight: 600,
        padding: "2px 6px",
        borderRadius: 4,
        background: style.bg,
        color: style.color,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        fontFamily: "monospace",
        flexShrink: 0,
      }}
    >
      {style.label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

export function formatRelativeTime(iso: string): string {
  try {
    const date = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    if (diffMs < 0) return "just now";
    const diffMin = Math.floor(diffMs / 60_000);

    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 30) return `${diffDay}d ago`;
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

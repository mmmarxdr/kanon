import { useNavigate } from "@tanstack/react-router";
import type { IssueDocument, DocumentKind } from "@/types/issue";

interface DocumentListProps {
  documents: IssueDocument[];
  isLoading: boolean;
  issueKey: string;
}

/**
 * Design Records tab content for the issue detail panel.
 *
 * Read-only collapsed card list. Documents are created by agents via MCP
 * (kanon_create_document). Each card shows: kind badge, title, author, date.
 * Clicking a card navigates to the full-page document route
 * /issue/:key/doc/:docId.
 */
export function DocumentList({ documents, isLoading, issueKey }: DocumentListProps) {
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
        Loading design records…
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
        <span>No design records yet.</span>
        <span style={{ fontSize: 11.5, color: "var(--ink-4)" }}>
          Use <code style={{ fontFamily: "monospace" }}>kanon_create_document</code> via MCP to record an ADR, PDR, RFC, or note.
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
/*  Collapsed card (exported for testing)                              */
/* ------------------------------------------------------------------ */

export interface DocumentCardProps {
  document: IssueDocument;
  issueKey: string;
}

export function DocumentCard({ document: doc, issueKey }: DocumentCardProps) {
  const navigate = useNavigate();

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

  return (
    <li
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      data-testid="document-card"
      aria-label={`${KIND_STYLES[doc.kind].label}: ${doc.title}`}
      style={{
        borderRadius: 6,
        border: "1px solid var(--line)",
        background: "var(--panel)",
        padding: "10px 14px",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 8,
        transition: "border-color 0.1s",
      }}
    >
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

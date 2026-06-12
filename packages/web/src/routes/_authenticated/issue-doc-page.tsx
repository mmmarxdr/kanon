import { useNavigate } from "@tanstack/react-router";
import { issueDocRoute } from "./issue-doc";
import { useIssueDocuments } from "@/features/issue-detail/use-issue-detail-queries";
import { Markdown } from "@/components/ui/markdown";
import { KindBadge, formatRelativeTime } from "@/features/issue-detail/document-list";
import { Icon } from "@/components/ui/icons";

/**
 * Full-page design record viewer.
 *
 * Fetches all documents for the issue (reuses the existing cached list query)
 * and finds the target document by docId client-side. No by-id endpoint exists;
 * this avoids a new API call by reusing the already-warm documents cache.
 *
 * Layout: comfortable prose reading width (max 720px), centered, with metadata
 * header and back-to-issue link.
 */
export default function IssueDocPage() {
  const { key: issueKey, docId } = issueDocRoute.useParams();
  const navigate = useNavigate();

  const { data: documents, isLoading, isError } = useIssueDocuments(issueKey);

  const doc = documents?.find((d) => d.id === docId);

  const handleBack = () => {
    void navigate({
      to: "/issue/$key",
      params: { key: issueKey },
    });
  };

  if (isError) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          color: "var(--ink-3)",
          fontSize: 13,
          background: "var(--bg)",
        }}
      >
        <span data-testid="error-message">Failed to load document. Please try again.</span>
        <button
          type="button"
          onClick={handleBack}
          data-testid="error-back-link"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            color: "var(--accent)",
            fontSize: 12,
            cursor: "pointer",
            background: "none",
            border: "none",
          }}
        >
          <Icon.ChevL /> Back to {issueKey}
        </button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--ink-3)",
          fontSize: 12,
          background: "var(--bg)",
        }}
      >
        Loading document…
      </div>
    );
  }

  if (!doc) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          color: "var(--ink-3)",
          fontSize: 13,
          background: "var(--bg)",
        }}
      >
        <span>Document not found.</span>
        <button
          type="button"
          onClick={handleBack}
          data-testid="back-link"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            color: "var(--accent)",
            fontSize: 12,
            cursor: "pointer",
            background: "none",
            border: "none",
          }}
        >
          <Icon.ChevL /> Back to {issueKey}
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        height: "100%",
        overflowY: "auto",
        background: "var(--bg)",
      }}
    >
      {/* Subtoolbar */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          padding: "10px 16px",
          borderBottom: "1px solid var(--line)",
          background: "var(--bg)",
        }}
      >
        <button
          type="button"
          onClick={handleBack}
          data-testid="back-link"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            color: "var(--ink-3)",
            fontSize: 12,
            cursor: "pointer",
            background: "none",
            border: "none",
          }}
        >
          <Icon.ChevL /> Back to {issueKey}
        </button>
      </div>

      {/* Prose content area */}
      <div
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding: "32px 24px 64px",
        }}
      >
        {/* Metadata header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 8,
            flexWrap: "wrap",
          }}
        >
          <KindBadge kind={doc.kind} />
          {doc.author && (
            <span style={{ fontSize: 12, color: "var(--ink-4)" }}>
              {doc.author.username}
            </span>
          )}
          <span style={{ fontSize: 12, color: "var(--ink-4)" }}>
            {formatRelativeTime(doc.createdAt)}
          </span>
        </div>

        <h1
          data-testid="doc-title"
          style={{
            fontSize: 22,
            fontWeight: 600,
            color: "var(--ink)",
            lineHeight: 1.3,
            marginBottom: 24,
            marginTop: 0,
          }}
        >
          {doc.title}
        </h1>

        {/* Document body */}
        <div
          data-testid="doc-body"
          style={{ color: "var(--ink-2)", lineHeight: 1.7 }}
        >
          <Markdown className="prose-doc">{doc.body}</Markdown>
        </div>
      </div>
    </div>
  );
}

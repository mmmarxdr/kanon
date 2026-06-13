import type { IssueDocument, ChildIssueSummary, IssueDependencyEdge } from "@/types/issue";
import { IssueDescription } from "./issue-description";
import { DocumentList } from "./document-list";
import { ChildrenSection } from "./children-section";
import { DependenciesSection } from "./dependencies-section";

export interface IssueTopZoneProps {
  issueKey: string;
  description: string | null | undefined;
  onDescriptionSave: (next: string) => void;
  documents: IssueDocument[];
  documentsLoading: boolean;
  children: ChildIssueSummary[];
  onSelectChild: (key: string) => void;
  blocks: IssueDependencyEdge[];
  blockedBy: IssueDependencyEdge[];
}

/**
 * KAN-108 slice 2 — IssueTopZone: scrollable content zone.
 *
 * Stacks all content sections in this order (owner-approved):
 *   Description → Design Records → Sub-issues → Dependencies
 *
 * flex:1 + minHeight:0 + overflowY:auto is the load-bearing CSS trio.
 * minHeight:0 is critical — without it flex children refuse to shrink below
 * content height and overflow:auto never engages, making the dock scroll off-screen.
 *
 * Section headings for Design Records / Sub-issues / Dependencies are minimal
 * labels with counts. Slice 3 replaces these with CollapsibleSection.
 * Do NOT add collapsibility here.
 */
export function IssueTopZone({
  issueKey,
  description,
  onDescriptionSave,
  documents,
  documentsLoading,
  children,
  onSelectChild,
  blocks,
  blockedBy,
}: IssueTopZoneProps) {
  const docCount = documents.length;
  const childCount = children.length;
  const depCount = blocks.length + blockedBy.length;

  return (
    <div
      data-testid="issue-top-zone"
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        padding: "16px 28px 24px",
      }}
    >
      {/* Description — always visible, no count, no heading beyond IssueDescription's own */}
      <IssueDescription value={description} onSave={onDescriptionSave} />

      {/* Design Records */}
      <div style={{ marginTop: 20 }}>
        <SectionHeading label="Design Records" count={docCount} />
        <DocumentList
          documents={documents}
          isLoading={documentsLoading}
          issueKey={issueKey}
        />
      </div>

      {/* Sub-issues */}
      <div style={{ marginTop: 20 }}>
        <SectionHeading label="Sub-issues" count={childCount} />
        <ChildrenSection children={children} onSelect={onSelectChild} />
      </div>

      {/* Dependencies */}
      <div style={{ marginTop: 20 }}>
        <SectionHeading label="Dependencies" count={depCount} />
        <DependenciesSection blocks={blocks} blockedBy={blockedBy} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Minimal section heading (slice 3 replaces with CollapsibleSection) */
/* ------------------------------------------------------------------ */

function SectionHeading({ label, count }: { label: string; count: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        marginBottom: 8,
      }}
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
        {label}
      </span>
      <span
        className="mono"
        style={{
          fontSize: 10,
          color: "var(--ink-4)",
        }}
      >
        {count}
      </span>
    </div>
  );
}

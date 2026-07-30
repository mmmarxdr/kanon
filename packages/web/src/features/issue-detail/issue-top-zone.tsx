import { useTranslation } from "react-i18next";
import type { IssueDocument, ChildIssueSummary, IssueDependencyEdge } from "@/types/issue";
import { IssueDescription } from "./issue-description";
import { DocumentList } from "./document-list";
import { ChildrenSection } from "./children-section";
import { DependenciesSection } from "./dependencies-section";
import { CollapsibleSection } from "./collapsible-section";
import { SECTION_IDS } from "./collapsible-section-ids";

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
 * KAN-108 slice 3 — IssueTopZone with CollapsibleSection disclosure.
 *
 * Default-open heuristic (design §C):
 *  - Description: always visible, NOT wrapped in CollapsibleSection.
 *  - Design Records: default OPEN (always).
 *  - Sub-issues: default OPEN when count ≤ 5; COLLAPSED when count > 5.
 *  - Dependencies: default OPEN when count ≤ 5; COLLAPSED when count > 5.
 *
 * Panel content is unmounted when collapsed (performance win — no Mermaid
 * mounting, no unnecessary renders). ChildrenSection/DependenciesSection
 * already return null when empty, so their inner testids are only present
 * when the section is expanded AND non-empty.
 *
 * flex:1 + minHeight:0 + overflowY:auto is the load-bearing CSS trio.
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
  const { t } = useTranslation("issue");
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
      {/* Description — always visible, no CollapsibleSection wrapper */}
      <IssueDescription value={description} onSave={onDescriptionSave} />

      {/* Design Records — default OPEN */}
      <div style={{ marginTop: 20 }}>
        <CollapsibleSection
          sectionId={SECTION_IDS.DESIGN_RECORDS}
          title={t("sectionDesignRecords")}
          count={docCount}
          issueKey={issueKey}
          defaultCollapsed={false}
        >
          <DocumentList
            documents={documents}
            isLoading={documentsLoading}
            issueKey={issueKey}
          />
        </CollapsibleSection>
      </div>

      {/* Sub-issues — default OPEN when ≤5, COLLAPSED when >5 */}
      <div style={{ marginTop: 20 }}>
        <CollapsibleSection
          sectionId={SECTION_IDS.SUB_ISSUES}
          title={t("sectionSubIssues")}
          count={childCount}
          issueKey={issueKey}
          defaultCollapsed={childCount > 5}
        >
          <ChildrenSection children={children} onSelect={onSelectChild} />
        </CollapsibleSection>
      </div>

      {/* Dependencies — default OPEN when ≤5, COLLAPSED when >5 */}
      <div style={{ marginTop: 20 }}>
        <CollapsibleSection
          sectionId={SECTION_IDS.DEPENDENCIES}
          title={t("sectionDependencies")}
          count={depCount}
          issueKey={issueKey}
          defaultCollapsed={depCount > 5}
        >
          <DependenciesSection blocks={blocks} blockedBy={blockedBy} />
        </CollapsibleSection>
      </div>
    </div>
  );
}

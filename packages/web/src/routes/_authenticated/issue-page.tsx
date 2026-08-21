import { useTranslation } from "react-i18next";
import { issueRoute, SubscribeButton } from "./issue";
import { getIssueWorkspaceState, useIssueDetail } from "@/features/issue-detail/use-issue-detail";
import { IssueDetailHeader } from "@/features/issue-detail/issue-detail-header";
import { MetadataSection } from "@/features/issue-detail/metadata-section";
import { IssueScheduleSlot } from "@/features/issue-detail/issue-schedule-slot";
import { SyncedFromToolsSlot } from "@/features/issue-detail/synced-from-tools-slot";
import { SyncedToolsSummary } from "@/features/issue-detail/synced-tools-summary";
import { IssueDeleteAction } from "@/features/issue-detail/issue-delete-action";
import { IssueDetailWorkspace } from "@/features/issue-detail/issue-detail-workspace";
import { IssueDescription } from "@/features/issue-detail/issue-description";
import { IssueComposer } from "@/features/issue-detail/issue-composer";
import { UnifiedTimeline } from "@/features/issue-detail/unified-timeline";
import { IssueGeneralNotes } from "@/features/issue-detail/issue-general-notes";
import { DocumentList } from "@/features/issue-detail/document-list";
import { ChildrenSection } from "@/features/issue-detail/children-section";
import { DependenciesSection } from "@/features/issue-detail/dependencies-section";
import { Icon } from "@/components/ui/icons";

export default function IssuePage() {
  const { key: issueKey } = issueRoute.useParams();
  const { t } = useTranslation("issue");
  const d = useIssueDetail(issueKey);
  const state = getIssueWorkspaceState(d);
  const issue = state.kind === "ready" ? d.issue : undefined;
  const deleteCapability: { allowed: boolean; redmineLinked: boolean } | undefined = issue && "deleteCapability" in issue ? issue.deleteCapability as { allowed: boolean; redmineLinked: boolean } : undefined;

  return <div className="issue-page" data-current-issue-key={issue?.key ?? issueKey}>
    {issue && <><div className="issue-subtoolbar"><button type="button" onClick={d.onBack}><Icon.ChevL /> {t("back")}</button><span /><SubscribeButton isSubscribed={d.isSubscribed} isSubscriptionPending={d.isSubscriptionPending} onToggle={d.onSubscribeToggle} /><IssueDeleteAction issueKey={issue.key} priority={issue.priority} capability={deleteCapability ?? { allowed: false, redmineLinked: false }} projectKey={d.projectKey} onDeleted={d.onDeleted} /></div><IssueDetailHeader issueKey={issue.key} title={issue.title} type={issue.type} priority={issue.priority} state={issue.state} hasAgent={(issue.activeWorkers ?? []).some((worker) => worker.isAgent)} onTitleChange={d.onTitleChange} onClose={d.onBack} /></>}
    <div className="issue-detail-layout">
      <IssueDetailWorkspace state={state} onRetry={d.refetch} onBack={d.onBack}
        general={issue && <><IssueDescription value={issue.description} onSave={d.onDescriptionSave} /><IssueGeneralNotes items={d.timeline.items} isLoading={d.timeline.isLoading} isError={d.timeline.isError} /></>}
        activity={issue && <><UnifiedTimeline items={d.timeline.items} isLoading={d.timeline.isLoading} isError={d.timeline.isError} /><IssueComposer onSubmit={d.onAddComment} isPending={d.addCommentPending} error={d.addCommentError} /></>}
        relationships={issue && <><ChildrenSection children={issue.children ?? []} onSelect={d.onSelectChild} /><DependenciesSection blocks={issue.blocks ?? []} blockedBy={issue.blockedBy ?? []} childrenCount={issue.children?.length ?? 0} /></>}
        resources={issue && <><DocumentList documents={d.documents ?? []} isLoading={d.documentsLoading} isError={Boolean(d.documentsError)} error={d.documentsError} issueKey={issueKey} /><SyncedFromToolsSlot issueKey={issueKey} /></>}
        metadata={issue && <><MetadataSection issue={issue} projectKey={d.projectKey} onFieldChange={d.onFieldChange} onTransition={d.onTransition} onCycleChange={d.onCycleChange} /><SyncedToolsSummary issueKey={issueKey} /><IssueScheduleSlot issueKey={issueKey} /></>}
      />
    </div>
  </div>;
}

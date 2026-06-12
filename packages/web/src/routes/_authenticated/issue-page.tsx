import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { issueRoute, SubscribeButton } from "./issue";
import { Markdown } from "@/components/ui/markdown";
import {
  useIssueDetailQuery,
  useIssueDocuments,
} from "@/features/issue-detail/use-issue-detail-queries";
import {
  useUpdateIssueMutation,
  useAddCommentMutation,
} from "@/features/issue-detail/use-issue-mutations";
import { useTransitionMutation } from "@/features/board/use-transition-mutation";
import {
  useAttachIssueMutation,
  useDetachIssueMutation,
} from "@/features/cycles/use-cycle-mutations";
import {
  useSubscribeMutation,
  useUnsubscribeMutation,
} from "@/features/issue-detail/use-subscription-mutations";
import { IssueDetailHeader } from "@/features/issue-detail/issue-detail-header";
import { MetadataSection } from "@/features/issue-detail/metadata-section";
import { ChildrenSection } from "@/features/issue-detail/children-section";
import { DependenciesSection } from "@/features/issue-detail/dependencies-section";
import { DocumentList } from "@/features/issue-detail/document-list";
import { UnifiedTimeline } from "@/features/issue-detail/unified-timeline";
import { useUnifiedTimeline } from "@/features/issue-detail/use-unified-timeline";
import type { IssueState } from "@/stores/board-store";
import { Icon } from "@/components/ui/icons";
import { Kbd } from "@/components/ui/primitives";

type Tab = "timeline" | "children" | "deps" | "documents";

export default function IssuePage() {
  const { key: issueKey } = issueRoute.useParams();
  const { from, tab: tabFromSearch } = issueRoute.useSearch();
  const navigate = useNavigate();

  const [tab, setTab] = useState<Tab>(tabFromSearch ?? "timeline");
  const [draft, setDraft] = useState("");
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { data: issue, isLoading } = useIssueDetailQuery(issueKey);
  const { data: documents, isLoading: documentsLoading } =
    useIssueDocuments(issueKey);
  // Unified timeline merges comments + activity (no new fetch — reuses caches)
  const unifiedTimeline = useUnifiedTimeline(issueKey);

  const projectKey = issue?.project.key ?? issueKey.split("-")[0] ?? "";
  const updateMutation = useUpdateIssueMutation(issueKey, projectKey);
  const addCommentMutation = useAddCommentMutation(issueKey);
  const transitionMutation = useTransitionMutation(projectKey);
  // Cycle attach/detach mutations — constructed at top level because React
  // forbids conditional hook calls. cycleId is passed at mutate()-call time.
  const attachIssueMutation = useAttachIssueMutation(projectKey);
  const detachIssueMutation = useDetachIssueMutation(projectKey);

  // Subscription mutations
  const subscribeMutation = useSubscribeMutation(issueKey);
  const unsubscribeMutation = useUnsubscribeMutation(issueKey);
  const isSubscribed = issue?.subscribed ?? false;
  const isSubscriptionPending =
    subscribeMutation.isPending || unsubscribeMutation.isPending;
  const handleSubscribeToggle = useCallback(() => {
    if (isSubscriptionPending) return;
    if (isSubscribed) {
      unsubscribeMutation.mutate();
    } else {
      subscribeMutation.mutate();
    }
  }, [isSubscribed, isSubscriptionPending, subscribeMutation, unsubscribeMutation]);

  useEffect(() => {
    if (!isEditingDescription && issue?.description !== undefined) {
      setDescriptionDraft(issue.description ?? "");
    }
  }, [issue?.description, isEditingDescription]);

  useEffect(() => {
    if (isEditingDescription) textareaRef.current?.focus();
  }, [isEditingDescription]);

  const handleBack = useCallback(() => {
    if (from === "board" && projectKey) {
      void navigate({ to: "/board/$projectKey", params: { projectKey } });
      return;
    }
    if (window.history.length > 1) {
      window.history.back();
    } else {
      void navigate({ to: "/inbox" });
    }
  }, [navigate, from, projectKey]);

  const handleTitleChange = useCallback(
    (newTitle: string) => updateMutation.mutate({ title: newTitle }),
    [updateMutation],
  );
  const handleFieldChange = useCallback(
    (payload: Record<string, unknown>) =>
      updateMutation.mutate(
        payload as Parameters<typeof updateMutation.mutate>[0],
      ),
    [updateMutation],
  );
  const handleTransition = useCallback(
    (toState: IssueState) =>
      transitionMutation.mutate({ issueKey, toState }),
    [transitionMutation, issueKey],
  );
  const handleAddComment = useCallback(
    (body: string) => addCommentMutation.mutate(body),
    [addCommentMutation],
  );
  const handleSelectChild = useCallback(
    (childKey: string) => {
      void navigate({
        to: "/issue/$key",
        params: { key: childKey },
        search: from ? { from } : {},
      });
    },
    [navigate, from],
  );
  const handleDescriptionSave = useCallback(() => {
    setIsEditingDescription(false);
    const trimmed = descriptionDraft.trim();
    const original = (issue?.description ?? "").trim();
    if (trimmed !== original) {
      updateMutation.mutate({ description: trimmed });
    }
  }, [descriptionDraft, issue?.description, updateMutation]);

  /**
   * Handles cycle assignment changes from MetadataSection.
   *
   * Sequencing:
   * - If currentCycleId is set, detach first (await).
   * - Only after detach resolves (or if no detach needed), attach to nextCycleId.
   * This ensures CycleScopeEvent history is preserved correctly.
   */
  const handleCycleChange = useCallback(
    async (nextCycleId: string | null, currentCycleId: string | null) => {
      if (!nextCycleId && !currentCycleId) return;

      if (currentCycleId) {
        await detachIssueMutation.mutateAsync({
          cycleId: currentCycleId,
          issueKey,
          context: "issue-detail",
        });
      }
      if (nextCycleId) {
        attachIssueMutation.mutate({
          cycleId: nextCycleId,
          issueKey,
          context: "issue-detail",
        });
      }
    },
    [issueKey, attachIssueMutation, detachIssueMutation],
  );

  if (isLoading || !issue) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--ink-3)",
          fontSize: 12,
        }}
      >
        Loading issue…
      </div>
    );
  }

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "timeline", label: "Timeline", count: unifiedTimeline.items.length },
    { id: "children", label: "Sub-issues", count: issue.children?.length ?? 0 },
    {
      id: "deps",
      label: "Dependencies",
      count:
        (issue.blocks?.length ?? 0) + (issue.blockedBy?.length ?? 0),
    },
    { id: "documents", label: "Design Records", count: documents?.length ?? 0 },
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 380px",
        height: "100%",
        overflow: "hidden",
        background: "var(--bg)",
      }}
    >
      {/* MAIN PANE */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          borderRight: "1px solid var(--line)",
          minWidth: 0,
        }}
      >
        {/* Subtoolbar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 16px",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <button
            type="button"
            onClick={handleBack}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              color: "var(--ink-3)",
              fontSize: 12,
            }}
          >
            <Icon.ChevL /> Back
          </button>
          <span style={{ flex: 1 }} />
          <SubscribeButton
            isSubscribed={isSubscribed}
            isSubscriptionPending={isSubscriptionPending}
            onToggle={handleSubscribeToggle}
          />
          <button type="button" style={{ color: "var(--ink-4)" }}>
            <Icon.More />
          </button>
        </div>

        <IssueDetailHeader
          issueKey={issue.key}
          title={issue.title}
          type={issue.type}
          priority={issue.priority}
          state={issue.state}
          hasAgent={(issue.activeWorkers ?? []).some((w) => w.isAgent)}
          onTitleChange={handleTitleChange}
          onClose={handleBack}
        />

        {/* Description */}
        <div style={{ padding: "16px 28px 0", minWidth: 0 }}>
          <div
            style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}
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
              Description
            </span>
            {isEditingDescription ? (
              <textarea
                ref={textareaRef}
                value={descriptionDraft}
                onChange={(e) => setDescriptionDraft(e.target.value)}
                onBlur={handleDescriptionSave}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setDescriptionDraft(issue.description ?? "");
                    setIsEditingDescription(false);
                  }
                }}
                rows={6}
                placeholder="Add a description (supports Markdown)…"
                aria-label="Issue description"
                style={{
                  width: "100%",
                  minHeight: 96,
                  maxHeight: "40vh",
                  padding: "10px 12px",
                  background: "var(--panel)",
                  border: "1px solid var(--line)",
                  borderRadius: 6,
                  color: "var(--ink)",
                  fontSize: 13,
                  lineHeight: 1.55,
                  outline: "none",
                  resize: "vertical",
                  fontFamily: "Inter Tight",
                  boxSizing: "border-box",
                }}
              />
            ) : (
              <div
                role="button"
                tabIndex={0}
                onClick={() => setIsEditingDescription(true)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setIsEditingDescription(true);
                  }
                }}
                style={{
                  display: "block",
                  width: "100%",
                  minWidth: 0,
                  maxWidth: "100%",
                  minHeight: 56,
                  maxHeight: 240,
                  overflowY: "auto",
                  // "clip" was clipping child <pre> horizontal scroll (ASCII/code-block bug).
                  // "auto" lets wide code blocks scroll independently.
                  overflowX: "auto",
                  padding: "10px 12px",
                  background: "var(--panel)",
                  border: "1px solid var(--line)",
                  borderRadius: 6,
                  textAlign: "left",
                  cursor: "text",
                  boxSizing: "border-box",
                  // whiteSpace scoped to non-pre text via CSS cascade; do not set globally
                  // here as it would suppress horizontal scroll on <pre> descendants.
                  overflowWrap: "anywhere",
                  wordBreak: "break-word",
                }}
              >
                {issue.description ? (
                  <div
                    style={{
                      color: "var(--ink-2)",
                      fontSize: 13,
                      lineHeight: 1.55,
                      overflowWrap: "anywhere",
                      wordBreak: "break-word",
                      minWidth: 0,
                    }}
                  >
                    <Markdown>{issue.description}</Markdown>
                  </div>
                ) : (
                  <span
                    style={{
                      fontSize: 13,
                      color: "var(--ink-4)",
                      fontStyle: "italic",
                    }}
                  >
                    Click to add a description…
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            padding: "16px 28px 0",
            borderBottom: "1px solid var(--line)",
            flexShrink: 0,
          }}
        >
          {tabs.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                style={{
                  position: "relative",
                  padding: "8px 0",
                  fontSize: 12.5,
                  fontWeight: active ? 500 : 400,
                  color: active ? "var(--ink)" : "var(--ink-3)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {t.label}
                {t.count != null && (
                  <span
                    className="mono"
                    style={{ fontSize: 10, color: "var(--ink-4)" }}
                  >
                    {t.count}
                  </span>
                )}
                {active && (
                  <span
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      bottom: -1,
                      height: 2,
                      background: "var(--accent)",
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            padding: "16px 28px 24px",
          }}
        >
          {tab === "timeline" && (
            <UnifiedTimeline
              items={unifiedTimeline.items}
              isLoading={unifiedTimeline.isLoading}
              isError={unifiedTimeline.isError}
            />
          )}
          {tab === "children" && (
            <ChildrenSection
              children={issue.children ?? []}
              onSelect={handleSelectChild}
            />
          )}
          {tab === "deps" && (
            <DependenciesSection
              blocks={issue.blocks ?? []}
              blockedBy={issue.blockedBy ?? []}
            />
          )}
          {tab === "documents" && (
            <DocumentList
              documents={documents ?? []}
              isLoading={documentsLoading}
              issueKey={issueKey}
            />
          )}
        </div>

        {/* Composer */}
        <div
          style={{
            borderTop: "1px solid var(--line)",
            padding: "12px 28px",
            background: "var(--bg)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: "10px 12px",
              border: "1px solid var(--line)",
              borderRadius: 6,
              background: "var(--panel)",
            }}
          >
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  const trimmed = draft.trim();
                  if (!trimmed) return;
                  handleAddComment(trimmed);
                  setDraft("");
                }
              }}
              placeholder="Comment, or @claude to delegate…"
              rows={2}
              style={{
                flex: 1,
                border: "none",
                outline: "none",
                resize: "none",
                background: "transparent",
                fontSize: 12.5,
                lineHeight: 1.5,
                fontFamily: "Inter Tight",
                color: "var(--ink)",
              }}
            />
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                alignItems: "flex-end",
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 10,
                  color: "var(--ink-4)",
                }}
              >
                <Kbd>⌘</Kbd>
                <Kbd>↵</Kbd>
              </span>
              <button
                type="button"
                disabled={!draft.trim() || addCommentMutation.isPending}
                onClick={() => {
                  const trimmed = draft.trim();
                  if (!trimmed) return;
                  handleAddComment(trimmed);
                  setDraft("");
                }}
                style={{
                  height: 26,
                  padding: "0 12px",
                  fontSize: 11.5,
                  fontWeight: 500,
                  background: "var(--accent)",
                  color: "var(--btn-ink)",
                  borderRadius: 4,
                  cursor:
                    !draft.trim() || addCommentMutation.isPending
                      ? "not-allowed"
                      : "pointer",
                  opacity:
                    !draft.trim() || addCommentMutation.isPending ? 0.55 : 1,
                }}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT PANE: properties + agent thread */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          background: "var(--bg-2)",
        }}
      >
        <div
          style={{
            padding: "16px 18px",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <div
            className="mono"
            style={{
              fontSize: 10,
              color: "var(--ink-4)",
              letterSpacing: "0.06em",
              marginBottom: 10,
              textTransform: "uppercase",
            }}
          >
            Properties
          </div>
          <MetadataSection
            issue={issue}
            projectKey={projectKey}
            onFieldChange={handleFieldChange}
            onTransition={handleTransition}
            onCycleChange={(nextId, currentId) => {
              void handleCycleChange(nextId, currentId);
            }}
          />
        </div>

        {/* Reserved slot for future Schedule section (ADR-0005/KAN-98) */}
        <div data-testid="schedule-slot" style={{ flex: 1 }} />
      </div>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { createRoute, useNavigate } from "@tanstack/react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { authenticatedRoute } from "../_authenticated";
import {
  useIssueDetailQuery,
  useCommentsQuery,
  useActivityQuery,
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
import { IssueDetailHeader } from "@/features/issue-detail/issue-detail-header";
import { MetadataSection } from "@/features/issue-detail/metadata-section";
import { ChildrenSection } from "@/features/issue-detail/children-section";
import { DependenciesSection } from "@/features/issue-detail/dependencies-section";
import { AgentThread } from "@/features/issue-detail/agent-thread";
import { CommentsHighlightView } from "@/features/issue-detail/comments-highlight-view";
import { ActivityList } from "@/features/issue-detail/activity-list";
import { CommentList } from "@/features/issue-detail/comment-list";
import type { IssueState } from "@/stores/board-store";
import { Icon } from "@/components/ui/icons";
import { Kbd } from "@/components/ui/primitives";

export interface IssueRouteSearch {
  /** Optional return target so the back button knows where to go. */
  from?: string;
  /** When "mention", the right pane highlights the target comment. */
  highlight?: "mention";
  /** UUID of the comment to scroll to and highlight. Omitted for description mentions. */
  commentId?: string;
}

export const issueRoute = createRoute({
  path: "/issue/$key",
  getParentRoute: () => authenticatedRoute,
  component: IssuePage,
  validateSearch: (search: Record<string, unknown>): IssueRouteSearch => ({
    from: typeof search.from === "string" ? search.from : undefined,
    highlight: search.highlight === "mention" ? "mention" : undefined,
    commentId: typeof search.commentId === "string" ? search.commentId : undefined,
  }),
});

const HUMAN_SOURCES = new Set(["human"]);
const AGENT_SOURCES = new Set(["mcp", "engram_sync", "system"]);

type Tab = "activity" | "children" | "deps" | "comments";

/**
 * RightPaneContent — implements the 4-case behavior matrix (design §4.3, REQ-MENTION-010).
 *
 * | agentComments.length | highlight === "mention" && commentId | renders |
 * |---|---|---|
 * | > 0 | No  | AgentThread |
 * | > 0 | Yes | AgentThread (with highlight injected via prop) |
 * | 0   | No  | AgentThread (empty state) |
 * | 0   | Yes | CommentsHighlightView |
 *
 * Exported so it can be unit-tested independently from the router-integrated IssuePage.
 */
export interface RightPaneContentProps {
  comments: import("@/types/issue").Comment[];
  isCommentsLoading: boolean;
  highlight: "mention" | undefined;
  commentId: string | undefined;
}

export function RightPaneContent({
  comments,
  isCommentsLoading,
  highlight,
  commentId,
}: RightPaneContentProps) {
  const agentComments = comments.filter((c) => AGENT_SOURCES.has(c.source));

  const showCommentsInsteadOfThread =
    highlight === "mention" && commentId !== undefined && agentComments.length === 0;

  if (showCommentsInsteadOfThread) {
    return (
      <CommentsHighlightView
        comments={comments}
        highlightCommentId={commentId}
        data-testid="comments-list"
      />
    );
  }

  return (
    <div data-testid="agent-thread">
      <AgentThread
        comments={comments}
        isLoading={isCommentsLoading}
      />
    </div>
  );
}

function IssuePage() {
  const { key: issueKey } = issueRoute.useParams();
  const { from, highlight, commentId } = issueRoute.useSearch();
  const navigate = useNavigate();

  const [tab, setTab] = useState<Tab>("activity");
  const [draft, setDraft] = useState("");
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { data: issue, isLoading } = useIssueDetailQuery(issueKey);
  const { data: comments, isLoading: commentsLoading } =
    useCommentsQuery(issueKey);
  const { data: activities, isLoading: activitiesLoading } =
    useActivityQuery(issueKey);

  const projectKey = issue?.project.key ?? issueKey.split("-")[0] ?? "";
  const updateMutation = useUpdateIssueMutation(issueKey, projectKey);
  const addCommentMutation = useAddCommentMutation(issueKey);
  const transitionMutation = useTransitionMutation(projectKey);
  // Cycle attach/detach mutations — constructed at top level because React
  // forbids conditional hook calls. cycleId is passed at mutate()-call time.
  const attachIssueMutation = useAttachIssueMutation(projectKey);
  const detachIssueMutation = useDetachIssueMutation(projectKey);

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

  const humanComments = (comments ?? []).filter((c) =>
    HUMAN_SOURCES.has(c.source),
  );
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "activity", label: "Activity", count: activities?.length ?? 0 },
    { id: "children", label: "Sub-issues", count: issue.children?.length ?? 0 },
    {
      id: "deps",
      label: "Dependencies",
      count:
        (issue.blocks?.length ?? 0) + (issue.blockedBy?.length ?? 0),
    },
    { id: "comments", label: "Comments", count: humanComments.length },
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
          <button
            type="button"
            style={{
              height: 26,
              padding: "0 8px",
              borderRadius: 4,
              border: "1px solid var(--line)",
              background: "var(--panel)",
              fontSize: 11.5,
              color: "var(--ink-2)",
            }}
          >
            Subscribe
          </button>
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
                  overflowX: "clip",
                  padding: "10px 12px",
                  background: "var(--panel)",
                  border: "1px solid var(--line)",
                  borderRadius: 6,
                  textAlign: "left",
                  cursor: "text",
                  boxSizing: "border-box",
                  whiteSpace: "normal",
                  overflowWrap: "anywhere",
                  wordBreak: "break-word",
                }}
              >
                {issue.description ? (
                  <div
                    className="markdown-body"
                    style={{
                      color: "var(--ink-2)",
                      fontSize: 13,
                      lineHeight: 1.55,
                      overflowWrap: "anywhere",
                      wordBreak: "break-word",
                      minWidth: 0,
                    }}
                  >
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        table: ({ node: _node, ...props }) => (
                          <div style={{ overflowX: "auto", maxWidth: "100%" }}>
                            <table {...props} />
                          </div>
                        ),
                      }}
                    >
                      {issue.description}
                    </ReactMarkdown>
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
          {tab === "activity" && (
            <ActivityList
              activities={activities ?? []}
              isLoading={activitiesLoading}
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
          {tab === "comments" && (
            <CommentList
              comments={humanComments}
              isLoading={commentsLoading}
              onAddComment={handleAddComment}
              isSubmitting={addCommentMutation.isPending}
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

        <div style={{ flex: 1, overflow: "auto", padding: 14 }}>
          <RightPaneContent
            comments={comments ?? []}
            isCommentsLoading={commentsLoading}
            highlight={highlight}
            commentId={commentId}
          />
        </div>
      </div>
    </div>
  );
}

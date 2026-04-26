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
import { IssueDetailHeader } from "@/features/issue-detail/issue-detail-header";
import { MetadataSection } from "@/features/issue-detail/metadata-section";
import { ChildrenSection } from "@/features/issue-detail/children-section";
import { DependenciesSection } from "@/features/issue-detail/dependencies-section";
import { AgentThread } from "@/features/issue-detail/agent-thread";
import { ActivityList } from "@/features/issue-detail/activity-list";
import { CommentList } from "@/features/issue-detail/comment-list";
import type { IssueState } from "@/stores/board-store";
import { Icon } from "@/components/ui/icons";
import { Kbd } from "@/components/ui/primitives";

interface IssueRouteSearch {
  /** Optional return target so the back button knows where to go. */
  from?: string;
}

export const issueRoute = createRoute({
  path: "/issue/$key",
  getParentRoute: () => authenticatedRoute,
  component: IssuePage,
  validateSearch: (search: Record<string, unknown>): IssueRouteSearch => ({
    from: typeof search.from === "string" ? search.from : undefined,
  }),
});

const HUMAN_SOURCES = new Set(["human"]);

type Tab = "activity" | "children" | "deps" | "comments";

function IssuePage() {
  const { key: issueKey } = issueRoute.useParams();
  const { from } = issueRoute.useSearch();
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
        gridTemplateColumns: "1fr 380px",
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
        <div style={{ padding: "16px 28px 0" }}>
          <div
            style={{ display: "flex", flexDirection: "column", gap: 6 }}
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
                }}
              />
            ) : (
              <button
                type="button"
                onClick={() => setIsEditingDescription(true)}
                style={{
                  width: "100%",
                  minHeight: 56,
                  padding: "10px 12px",
                  background: "var(--panel)",
                  border: "1px solid var(--line)",
                  borderRadius: 6,
                  textAlign: "left",
                  cursor: "text",
                }}
              >
                {issue.description ? (
                  <div
                    style={{
                      color: "var(--ink-2)",
                      fontSize: 13,
                      lineHeight: 1.55,
                    }}
                  >
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
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
              </button>
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
          />
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: 14 }}>
          <AgentThread
            comments={comments ?? []}
            isLoading={commentsLoading}
          />
        </div>
      </div>
    </div>
  );
}

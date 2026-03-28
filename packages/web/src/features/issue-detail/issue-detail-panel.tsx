import { useState, useCallback, useEffect, useRef } from "react";
import { FocusTrap } from "focus-trap-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useNavigate } from "@tanstack/react-router";
import { IssueDetailHeader } from "./issue-detail-header";
import { MetadataSection } from "./metadata-section";
import { ChildrenSection } from "./children-section";
import { SessionContextSection } from "./session-context-section";
import { TabsSection } from "./tabs-section";
import {
  useIssueDetailQuery,
  useCommentsQuery,
  useActivityQuery,
} from "./use-issue-detail-queries";
import {
  useUpdateIssueMutation,
  useAddCommentMutation,
} from "./use-issue-mutations";
import { useTransitionMutation } from "@/features/board/use-transition-mutation";
import type { IssueState } from "@/stores/board-store";

interface IssueDetailPanelProps {
  issueKey: string;
  projectKey: string;
  onClose: () => void;
  triggerElement?: HTMLElement | null;
}

/**
 * Right slide-over panel displaying full issue details.
 *
 * Features:
 * - Semi-transparent backdrop overlay (click to close)
 * - Slide-in animation from right
 * - FocusTrap for accessibility (tab cycles within panel)
 * - Escape key to close
 * - Composes: Header (click-to-edit title), inline-editable description
 *   (markdown render / textarea toggle), MetadataSection, TabsSection
 * - role="dialog", aria-modal="true", aria-labelledby on title
 */
export function IssueDetailPanel({
  issueKey,
  projectKey,
  onClose,
  triggerElement,
}: IssueDetailPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Wrap onClose to return focus to the trigger element (R-IDP-11)
  const handleClose = useCallback(() => {
    onClose();
    // Use requestAnimationFrame to return focus after the panel unmounts
    if (triggerElement) {
      requestAnimationFrame(() => {
        triggerElement.focus();
      });
    }
  }, [onClose, triggerElement]);

  // Data queries
  const { data: issue, isLoading: issueLoading } =
    useIssueDetailQuery(issueKey);
  const { data: comments, isLoading: commentsLoading } =
    useCommentsQuery(issueKey);
  const { data: activities, isLoading: activitiesLoading } =
    useActivityQuery(issueKey);

  // Mutations
  const updateMutation = useUpdateIssueMutation(issueKey, projectKey);
  const addCommentMutation = useAddCommentMutation(issueKey);
  const transitionMutation = useTransitionMutation(projectKey);

  // Description inline editing state
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync draft when issue data changes (and not actively editing)
  useEffect(() => {
    if (!isEditingDescription && issue?.description !== undefined) {
      setDescriptionDraft(issue.description ?? "");
    }
  }, [issue?.description, isEditingDescription]);

  // Auto-focus textarea when entering description edit mode
  useEffect(() => {
    if (isEditingDescription) {
      textareaRef.current?.focus();
    }
  }, [isEditingDescription]);

  // Escape key handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [handleClose]);

  const handleTitleChange = useCallback(
    (newTitle: string) => {
      updateMutation.mutate({ title: newTitle });
    },
    [updateMutation],
  );

  const handleFieldChange = useCallback(
    (payload: Record<string, unknown>) => {
      updateMutation.mutate(
        payload as Parameters<typeof updateMutation.mutate>[0],
      );
    },
    [updateMutation],
  );

  const handleTransition = useCallback(
    (toState: IssueState) => {
      transitionMutation.mutate({ issueKey, toState });
    },
    [transitionMutation, issueKey],
  );

  const handleDescriptionSave = useCallback(() => {
    setIsEditingDescription(false);
    const trimmed = descriptionDraft.trim();
    const original = (issue?.description ?? "").trim();
    if (trimmed !== original) {
      updateMutation.mutate({ description: trimmed });
    }
  }, [descriptionDraft, issue?.description, updateMutation]);

  const handleAddComment = useCallback(
    (body: string) => {
      addCommentMutation.mutate(body);
    },
    [addCommentMutation],
  );

  const handleSelectChild = useCallback(
    (childKey: string) => {
      void navigate({
        search: (prev) => ({ ...prev, issue: childKey }),
      } as Parameters<typeof navigate>[0]);
    },
    [navigate],
  );

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Only close if clicking the backdrop itself, not the panel
      if (e.target === e.currentTarget) {
        handleClose();
      }
    },
    [handleClose],
  );

  return (
    <FocusTrap
      focusTrapOptions={{
        escapeDeactivates: false, // We handle Escape ourselves for URL cleanup
        allowOutsideClick: true,
        clickOutsideDeactivates: false,
      }}
    >
      <div
        className="fixed inset-0 z-50 flex justify-end"
        onClick={handleBackdropClick}
      >
        {/* Semi-transparent backdrop */}
        <div className="absolute inset-0 bg-black/20 animate-fade-in" aria-hidden="true" />

        {/* Slide-in panel */}
        <div
          ref={panelRef}
          data-testid="issue-detail-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="issue-detail-title"
          className="relative w-[60vw] max-w-4xl min-w-[320px]
            max-md:w-full
            h-full bg-card border-l border-border shadow-lg
            overflow-y-auto
            animate-slide-in-right"
        >
          {issueLoading || !issue ? (
            <div className="flex items-center justify-center h-full p-8">
              <p className="text-muted-foreground">Loading issue...</p>
            </div>
          ) : (
            <div className="flex flex-col gap-5 p-5">
              {/* Header: key badge + editable title + close button */}
              <IssueDetailHeader
                issueKey={issue.key}
                title={issue.title}
                onTitleChange={handleTitleChange}
                onClose={handleClose}
              />

              {/* Description: markdown render / textarea toggle */}
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
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
                    className="w-full rounded border border-border bg-secondary px-3 py-2
                      text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/30
                      resize-y min-h-[6rem]"
                    placeholder="Add a description (supports Markdown)..."
                    aria-label="Issue description"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsEditingDescription(true)}
                    className="w-full text-left rounded px-3 py-2 min-h-[3rem]
                      hover:bg-secondary transition-colors cursor-text"
                  >
                    {issue.description ? (
                      <div className="prose prose-sm max-w-none text-foreground">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {issue.description}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground italic">
                        Click to add a description...
                      </span>
                    )}
                  </button>
                )}
              </div>

              {/* Metadata fields */}
              <MetadataSection
                issue={issue}
                projectKey={projectKey}
                onFieldChange={handleFieldChange}
                onTransition={handleTransition}
              />

              {/* AI session context */}
              <SessionContextSection issueKey={issue.key} />

              {/* Child issues (sub-tasks) */}
              {issue.children && issue.children.length > 0 && (
                <ChildrenSection
                  children={issue.children}
                  onSelect={handleSelectChild}
                />
              )}

              {/* Tabs: Comments / Activity */}
              <TabsSection
                comments={comments ?? []}
                commentsLoading={commentsLoading}
                activities={activities ?? []}
                activitiesLoading={activitiesLoading}
                onAddComment={handleAddComment}
                isSubmittingComment={addCommentMutation.isPending}
              />
            </div>
          )}
        </div>
      </div>
    </FocusTrap>
  );
}

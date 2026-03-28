import { useState, useCallback, useEffect, useRef } from "react";
import { FocusTrap } from "focus-trap-react";
import { useCreateIssueMutation } from "./use-create-issue-mutation";
import { useIssuesQuery } from "./use-issues-query";
import type { IssueType, IssuePriority } from "@/types/issue";

const ISSUE_TYPES: { value: IssueType; label: string }[] = [
  { value: "task", label: "Task" },
  { value: "feature", label: "Feature" },
  { value: "bug", label: "Bug" },
  { value: "spike", label: "Spike" },
];

const ISSUE_PRIORITIES: { value: IssuePriority; label: string }[] = [
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

type IssueTemplateEntry = {
  key: string;
  name: string;
  type: IssueType;
  priority: IssuePriority;
  labels: string[];
  descriptionTemplate: string;
};

const TEMPLATES: IssueTemplateEntry[] = [
  {
    key: "bug-report",
    name: "Bug Report",
    type: "bug",
    priority: "high",
    labels: ["bug"],
    descriptionTemplate:
      "## Steps to Reproduce\n\n1. \n\n## Expected Behavior\n\n\n## Actual Behavior\n\n\n## Environment\n\n",
  },
  {
    key: "feature-request",
    name: "Feature Request",
    type: "feature",
    priority: "medium",
    labels: ["enhancement"],
    descriptionTemplate:
      "## User Story\n\nAs a..., I want..., so that...\n\n## Acceptance Criteria\n\n- [ ] \n\n## Design Notes\n\n",
  },
  {
    key: "task",
    name: "Task",
    type: "task",
    priority: "medium",
    labels: [],
    descriptionTemplate: "",
  },
  {
    key: "spike",
    name: "Spike",
    type: "spike",
    priority: "medium",
    labels: ["investigation"],
    descriptionTemplate:
      "## Question\n\n\n## Approach\n\n\n## Time-box\n\n\n## Deliverable\n\n",
  },
];

interface NewIssueModalProps {
  projectKey: string;
  onClose: () => void;
}

/**
 * Modal for creating a new issue.
 *
 * Features:
 * - FocusTrap for accessibility
 * - Escape key to close
 * - Enter in title submits (if title not empty)
 * - Loading state on Create button during mutation
 * - Semi-transparent backdrop (click to close)
 */
export function NewIssueModal({ projectKey, onClose }: NewIssueModalProps) {
  const titleRef = useRef<HTMLInputElement>(null);
  const createMutation = useCreateIssueMutation(projectKey);
  const { data: issues } = useIssuesQuery(projectKey);

  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<IssueType>("task");
  const [priority, setPriority] = useState<IssuePriority>("medium");
  const [labels, setLabels] = useState("");
  const [parentId, setParentId] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("");

  // Escape key handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSubmit = useCallback(() => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    const parsedLabels = labels
      .split(",")
      .map((l) => l.trim())
      .filter(Boolean);

    createMutation.mutate(
      {
        title: trimmedTitle,
        description: description.trim() || undefined,
        type,
        priority,
        labels: parsedLabels.length > 0 ? parsedLabels : undefined,
        parentId: parentId || undefined,
      },
      {
        onSuccess: () => {
          onClose();
        },
      },
    );
  }, [title, description, type, priority, labels, parentId, createMutation, onClose]);

  const handleTitleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && title.trim()) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [title, handleSubmit],
  );

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose],
  );

  const handleTemplateChange = useCallback((key: string) => {
    setSelectedTemplate(key);
    if (!key) {
      setType("task");
      setPriority("medium");
      setLabels("");
      setDescription("");
      return;
    }
    const tmpl = TEMPLATES.find((t) => t.key === key);
    if (tmpl) {
      setType(tmpl.type);
      setPriority(tmpl.priority);
      setLabels(tmpl.labels.join(", "));
      setDescription(tmpl.descriptionTemplate);
    }
  }, []);

  const inputClass =
    "w-full rounded-md border-none bg-[#E8E8E8] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary transition-all duration-150 ease-out";

  const selectClass =
    "w-full rounded-md border-none bg-[#E8E8E8] px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary transition-all duration-150 ease-out";

  return (
    <FocusTrap
      focusTrapOptions={{
        escapeDeactivates: false,
        allowOutsideClick: true,
        clickOutsideDeactivates: false,
        initialFocus: false,
      }}
    >
      <div
        className="fixed inset-0 z-50 flex items-center justify-center"
        onClick={handleBackdropClick}
      >
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/20 backdrop-blur-sm animate-fade-in"
          aria-hidden="true"
        />

        {/* Modal card */}
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-issue-title"
          data-testid="new-issue-modal"
          className="relative bg-card rounded-lg shadow-xl max-w-lg w-full p-6 mx-4 animate-fade-in"
        >
          {/* Close button */}
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>

          {/* Title */}
          <h2
            id="new-issue-title"
            className="text-lg font-semibold text-foreground mb-4"
          >
            New Issue
          </h2>

          {/* Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
            className="flex flex-col gap-4"
          >
            {/* Template selector */}
            <div>
              <label
                htmlFor="issue-template"
                className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1 block"
              >
                Template
              </label>
              <select
                id="issue-template"
                value={selectedTemplate}
                onChange={(e) => handleTemplateChange(e.target.value)}
                className={selectClass}
                data-testid="new-issue-template"
              >
                <option value="">None</option>
                {TEMPLATES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Issue title */}
            <div>
              <label
                htmlFor="issue-title"
                className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1 block"
              >
                Title <span className="text-destructive">*</span>
              </label>
              <input
                ref={titleRef}
                id="issue-title"
                type="text"
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={handleTitleKeyDown}
                placeholder="Issue title"
                className={`${inputClass} text-lg`}
                data-testid="new-issue-title-input"
              />
            </div>

            {/* Type and Priority in two columns */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="issue-type"
                  className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1 block"
                >
                  Type
                </label>
                <select
                  id="issue-type"
                  value={type}
                  onChange={(e) => setType(e.target.value as IssueType)}
                  className={selectClass}
                  data-testid="new-issue-type"
                >
                  {ISSUE_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="issue-priority"
                  className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1 block"
                >
                  Priority
                </label>
                <select
                  id="issue-priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as IssuePriority)}
                  className={selectClass}
                  data-testid="new-issue-priority"
                >
                  {ISSUE_PRIORITIES.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Description */}
            <div>
              <label
                htmlFor="issue-description"
                className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1 block"
              >
                Description
              </label>
              <textarea
                id="issue-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder="Add description..."
                className={`${inputClass} resize-y`}
                data-testid="new-issue-description"
              />
            </div>

            {/* Labels and Parent in a row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="issue-labels"
                  className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1 block"
                >
                  Labels
                </label>
                <input
                  id="issue-labels"
                  type="text"
                  value={labels}
                  onChange={(e) => setLabels(e.target.value)}
                  placeholder="bug-fix, ui (comma-separated)"
                  className={inputClass}
                  data-testid="new-issue-labels"
                />
              </div>
              <div>
                <label
                  htmlFor="issue-parent"
                  className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1 block"
                >
                  Parent Issue
                </label>
                <select
                  id="issue-parent"
                  value={parentId}
                  onChange={(e) => setParentId(e.target.value)}
                  className={selectClass}
                  data-testid="new-issue-parent"
                >
                  <option value="">None</option>
                  {issues?.map((issue) => (
                    <option key={issue.id} value={issue.id}>
                      {issue.key}: {issue.title}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex justify-end gap-3 mt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!title.trim() || createMutation.isPending}
                className="px-4 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                data-testid="new-issue-submit"
              >
                {createMutation.isPending && (
                  <svg
                    className="animate-spin h-4 w-4"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                )}
                Create Issue
              </button>
            </div>
          </form>
        </div>
      </div>
    </FocusTrap>
  );
}

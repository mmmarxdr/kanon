import { useState, useCallback, useEffect } from "react";
import { FocusTrap } from "focus-trap-react";
import { useCreateIssueMutation } from "./use-create-issue-mutation";
import { useIssuesQuery } from "./use-issues-query";
import type { IssueType, IssuePriority } from "@/types/issue";
import {
  STATE_LABELS,
  ISSUE_STATES,
  type IssueState,
} from "@/stores/board-store";
import { Icon } from "@/components/ui/icons";
import { FilterChipSelect } from "@/components/ui/primitives";

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

const STATE_OPTIONS = ISSUE_STATES.map((s) => ({
  value: s,
  label: STATE_LABELS[s],
}));

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

const TEMPLATE_OPTIONS = TEMPLATES.map((t) => ({ value: t.key, label: t.name }));

interface NewIssueModalProps {
  projectKey: string;
  onClose: () => void;
  defaultState?: IssueState;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 32,
  padding: "0 10px",
  background: "var(--bg)",
  border: "1px solid var(--line)",
  borderRadius: 5,
  color: "var(--ink)",
  fontSize: 12.5,
  outline: "none",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 10,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--ink-4)",
  marginBottom: 4,
  fontFamily: "JetBrains Mono, monospace",
};

export function NewIssueModal({
  projectKey,
  onClose,
  defaultState,
}: NewIssueModalProps) {
  const createMutation = useCreateIssueMutation(projectKey);
  const { data: issues } = useIssuesQuery(projectKey);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<IssueType>("task");
  const [priority, setPriority] = useState<IssuePriority>("medium");
  const [state, setState] = useState<IssueState>(defaultState ?? "backlog");
  const [labels, setLabels] = useState("");
  const [parentId, setParentId] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
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
        state,
        labels: parsedLabels.length > 0 ? parsedLabels : undefined,
        parentId: parentId || undefined,
      },
      { onSuccess: () => onClose() },
    );
  }, [title, description, type, priority, state, labels, parentId, createMutation, onClose]);

  const handleTitleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && title.trim() && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [title, handleSubmit],
  );

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onClose();
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
        onClick={handleBackdropClick}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 50,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: "8vh 16px 16px",
          background: "color-mix(in oklch, var(--bg) 70%, transparent)",
          backdropFilter: "blur(4px)",
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-issue-title-label"
          data-testid="new-issue-modal"
          style={{
            position: "relative",
            width: "100%",
            maxWidth: 560,
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: 8,
            boxShadow: "var(--shadow-drag)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "12px 14px",
              borderBottom: "1px solid var(--line)",
              background: "var(--bg-2)",
            }}
          >
            <span
              className="mono"
              style={{
                fontSize: 10.5,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--ink-4)",
              }}
            >
              New issue
            </span>
            <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
              · {projectKey}
            </span>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={{ color: "var(--ink-4)", padding: 2 }}
            >
              <Icon.X />
            </button>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 14,
              padding: "16px 16px 14px",
            }}
          >
            {/* Title — flush, no label */}
            <input
              id="new-issue-title-label"
              type="text"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={handleTitleKeyDown}
              placeholder="Issue title"
              data-testid="new-issue-title-input"
              style={{
                width: "100%",
                background: "transparent",
                border: "none",
                outline: "none",
                color: "var(--ink)",
                fontSize: 16,
                fontWeight: 500,
                padding: "2px 0",
              }}
            />

            {/* Description */}
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              placeholder="Add description…"
              data-testid="new-issue-description"
              style={{
                width: "100%",
                background: "var(--bg)",
                border: "1px solid var(--line)",
                borderRadius: 5,
                padding: "10px 12px",
                color: "var(--ink)",
                fontSize: 12.5,
                lineHeight: 1.5,
                outline: "none",
                resize: "vertical",
                minHeight: 96,
                fontFamily: "inherit",
              }}
            />

            {/* Filter chips row — type / priority / state */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <FilterChipSelect
                label="Type"
                value={type}
                options={ISSUE_TYPES}
                onChange={(v) => setType((v || "task") as IssueType)}
                allLabel="task"
              />
              <FilterChipSelect
                label="Priority"
                value={priority}
                options={ISSUE_PRIORITIES}
                onChange={(v) => setPriority((v || "medium") as IssuePriority)}
                allLabel="medium"
              />
              <FilterChipSelect
                label="State"
                value={state}
                options={STATE_OPTIONS}
                onChange={(v) => setState((v || "backlog") as IssueState)}
                allLabel="backlog"
              />
              <FilterChipSelect
                label="Template"
                value={selectedTemplate}
                options={TEMPLATE_OPTIONS}
                onChange={handleTemplateChange}
                allLabel="none"
              />
            </div>

            {/* Labels + Parent */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              <div>
                <label htmlFor="issue-labels" style={labelStyle}>
                  Labels
                </label>
                <input
                  id="issue-labels"
                  type="text"
                  value={labels}
                  onChange={(e) => setLabels(e.target.value)}
                  placeholder="bug, ui (comma-separated)"
                  data-testid="new-issue-labels"
                  style={inputStyle}
                />
              </div>
              <div>
                <label htmlFor="issue-parent" style={labelStyle}>
                  Parent issue
                </label>
                <select
                  id="issue-parent"
                  value={parentId}
                  onChange={(e) => setParentId(e.target.value)}
                  data-testid="new-issue-parent"
                  style={{ ...inputStyle, paddingLeft: 8 }}
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
          </form>

          {/* Footer */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 14px",
              borderTop: "1px solid var(--line)",
              background: "var(--bg-2)",
            }}
          >
            <span
              className="mono"
              style={{ fontSize: 10.5, color: "var(--ink-4)" }}
            >
              ⌘↵ to create · Esc to close
            </span>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              onClick={onClose}
              style={{
                height: 28,
                padding: "0 12px",
                border: "1px solid var(--line)",
                borderRadius: 4,
                background: "var(--panel)",
                color: "var(--ink-2)",
                fontSize: 12,
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!title.trim() || createMutation.isPending}
              data-testid="new-issue-submit"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                height: 28,
                padding: "0 12px",
                border: "none",
                borderRadius: 4,
                background: "var(--accent)",
                color: "var(--btn-ink)",
                fontSize: 12,
                fontWeight: 500,
                opacity: !title.trim() || createMutation.isPending ? 0.55 : 1,
                cursor: !title.trim() || createMutation.isPending ? "not-allowed" : "pointer",
              }}
            >
              {createMutation.isPending ? "Creating…" : "Create issue"}
            </button>
          </div>
        </div>
      </div>
    </FocusTrap>
  );
}

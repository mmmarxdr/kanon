/**
 * Static issue template registry.
 * Templates pre-fill type, priority, labels, and description scaffold
 * when creating issues via API, MCP, or web UI.
 */

export type IssueTemplate = {
  key: string;
  name: string;
  type: "feature" | "bug" | "task" | "spike";
  priority: "critical" | "high" | "medium" | "low";
  labels: string[];
  descriptionTemplate: string;
};

export const ISSUE_TEMPLATES: Record<string, IssueTemplate> = {
  "bug-report": {
    key: "bug-report",
    name: "Bug Report",
    type: "bug",
    priority: "high",
    labels: ["bug"],
    descriptionTemplate:
      "## Steps to Reproduce\n\n1. \n\n## Expected Behavior\n\n\n## Actual Behavior\n\n\n## Environment\n\n",
  },
  "feature-request": {
    key: "feature-request",
    name: "Feature Request",
    type: "feature",
    priority: "medium",
    labels: ["enhancement"],
    descriptionTemplate:
      "## User Story\n\nAs a..., I want..., so that...\n\n## Acceptance Criteria\n\n- [ ] \n\n## Design Notes\n\n",
  },
  task: {
    key: "task",
    name: "Task",
    type: "task",
    priority: "medium",
    labels: [],
    descriptionTemplate: "",
  },
  spike: {
    key: "spike",
    name: "Spike",
    type: "spike",
    priority: "medium",
    labels: ["investigation"],
    descriptionTemplate:
      "## Question\n\n\n## Approach\n\n\n## Time-box\n\n\n## Deliverable\n\n",
  },
};

/**
 * Resolve a template by key.
 * Returns undefined if the key does not match any registered template.
 */
export function resolveTemplate(key: string): IssueTemplate | undefined {
  return ISSUE_TEMPLATES[key];
}

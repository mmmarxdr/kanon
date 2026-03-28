import type {
  CreateObservationPayload,
} from "./types.js";

// ─── Kanon Issue Shape ──────────────────────────────────────────────────────
// Minimal interface matching the fields available on KanonIssue from the CLI
// package. Defined locally to avoid a cross-package dependency.

/**
 * Minimal Kanon issue shape consumed by the reverse mapper.
 *
 * Mirrors `KanonIssue` from `packages/cli/src/kanon-client.ts` but only
 * declares the fields the mapper actually reads.
 */
export interface ReverseMapperIssue {
  key: string;
  title: string;
  type: string;
  state: string;
  priority: string;
  description?: string | null;
  labels?: string[];
}

/**
 * Minimal child issue shape for checklist rendering.
 */
export interface ReverseMapperChild {
  key: string;
  title: string;
  state: string;
}

// ─── ReverseEntityMapper ────────────────────────────────────────────────────

/**
 * Converts Kanon issues to Engram observation content (structured markdown).
 *
 * The markdown format uses a consistent template that can be parsed back:
 * - H1 heading with issue key and title
 * - Metadata block with key/value pairs
 * - Description section
 * - Children checklist section (if applicable)
 */
export class ReverseEntityMapper {
  /**
   * Convert a Kanon issue (plus optional children) to structured markdown
   * suitable for an Engram observation's `content` field.
   *
   * Format:
   * ```markdown
   * # KAN-5: Feature Title
   *
   * **Type:** feature
   * **Priority:** high
   * **State:** apply
   * **Labels:** sync, backend
   *
   * ## Description
   *
   * Issue description text...
   *
   * ## Children
   *
   * - [x] KAN-6: Completed child task
   * - [ ] KAN-7: Pending child task
   * ```
   */
  static issueToObservationContent(
    issue: ReverseMapperIssue,
    children?: ReverseMapperChild[],
  ): string {
    const lines: string[] = [];

    // ── H1 heading ──
    lines.push(`# ${issue.key}: ${issue.title}`);
    lines.push("");

    // ── Metadata block ──
    lines.push(`**Type:** ${issue.type}`);
    lines.push(`**Priority:** ${issue.priority}`);
    lines.push(`**State:** ${issue.state}`);

    if (issue.labels && issue.labels.length > 0) {
      lines.push(`**Labels:** ${issue.labels.join(", ")}`);
    }

    lines.push("");

    // ── Description section ──
    lines.push("## Description");
    lines.push("");
    lines.push(issue.description?.trim() || "_No description._");
    lines.push("");

    // ── Children checklist section ──
    if (children && children.length > 0) {
      lines.push("## Children");
      lines.push("");
      for (const child of children) {
        const done = child.state === "archived";
        const checkbox = done ? "[x]" : "[ ]";
        lines.push(`- ${checkbox} ${child.key}: ${child.title}`);
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * Derive the Engram topic_key for a Kanon issue.
   *
   * Format: `kanon/{projectKey}/{issueKey}`
   */
  static issueToTopicKey(issue: ReverseMapperIssue, projectKey: string): string {
    return `kanon/${projectKey}/${issue.key}`;
  }

  /**
   * Build a complete `CreateObservationPayload` for exporting an issue
   * to Engram.
   *
   * @param issue      The Kanon issue to export
   * @param projectKey The Kanon project key (e.g., "KAN")
   * @param namespace  The Engram project namespace to create the observation in
   * @param children   Optional child issues for the checklist section
   */
  static issueToCreatePayload(
    issue: ReverseMapperIssue,
    projectKey: string,
    namespace: string,
    children?: ReverseMapperChild[],
  ): CreateObservationPayload {
    return {
      title: `${issue.key}: ${issue.title}`,
      content: ReverseEntityMapper.issueToObservationContent(issue, children),
      type: "kanon-issue",
      project: namespace,
      scope: "project",
      topic_key: ReverseEntityMapper.issueToTopicKey(issue, projectKey),
    };
  }
}

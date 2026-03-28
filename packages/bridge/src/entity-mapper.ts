import type {
  CreateIssuePayload,
  KanonIssueState,
  SddChange,
  SddPhase,
  SddTask,
} from "./types.js";
import { SddParser } from "./sdd-parser.js";

/**
 * Phase-to-IssueState mapping.
 *
 * Maps SDD pipeline phases to Kanon's IssueState enum values.
 */
const PHASE_STATE_MAP: Record<SddPhase, KanonIssueState> = {
  explore: "explore",
  proposal: "propose",
  spec: "spec",
  design: "design",
  tasks: "tasks",
  "apply-progress": "apply",
  "verify-report": "verify",
  "archive-report": "archived",
  state: "backlog", // internal state artifact → default to backlog
};

/**
 * Maps SDD entities to Kanon issue payloads.
 */
export class EntityMapper {
  /**
   * Derive a groupKey from a topic_key prefix.
   *
   * For SDD observations with topic_key like `sdd/{changeName}/{phase}`,
   * returns `sdd/{changeName}`. Returns `null` if the topic_key is not
   * an SDD-format key.
   *
   * @example EntityMapper.deriveGroupKey("sdd/auth-model/spec") // "sdd/auth-model"
   * @example EntityMapper.deriveGroupKey("random-key") // null
   */
  static deriveGroupKey(topicKey: string | undefined): string | null {
    if (!topicKey) return null;
    const changeName = SddParser.extractChangeName(topicKey);
    if (!changeName) return null;
    return `sdd/${changeName}`;
  }

  /**
   * Map an SDD change to a parent Issue payload (type=feature).
   *
   * The title is derived from the proposal content (first heading or change name).
   * The state is derived from the latest phase in the pipeline.
   */
  static changeToParentIssue(
    change: SddChange,
    projectKey: string,
  ): CreateIssuePayload {
    const title = EntityMapper.extractTitle(change);
    const state = EntityMapper.phaseToIssueState(change.latestPhase);
    const groupKey = `sdd/${change.name}`;

    return {
      title,
      type: "feature",
      state,
      priority: "medium",
      labels: [`sdd:${change.name}`],
      groupKey,
      description: EntityMapper.buildDescription(change),
      specArtifacts: change.artifacts.has("proposal")
        ? {
            topicKey: `sdd/${change.name}/proposal`,
            engramId: change.artifacts.get("proposal")!.observationId,
            phase: change.latestPhase,
          }
        : undefined,
    };
  }

  /**
   * Map an SDD task item to a child Issue payload (type=task).
   *
   * Completed tasks (`done: true`) are mapped to state "archived".
   * Incomplete tasks are mapped to state "backlog".
   */
  static taskToChildIssue(
    task: SddTask,
    changeName: string,
    projectKey: string,
  ): CreateIssuePayload {
    return {
      title: task.title,
      type: "task",
      state: task.done ? "archived" : "backlog",
      priority: "medium",
      labels: [`sdd:${changeName}`],
      groupKey: `sdd/${changeName}`,
      description: task.description,
    };
  }

  /**
   * Map an SDD phase to a Kanon IssueState.
   */
  static phaseToIssueState(phase: SddPhase): KanonIssueState {
    return PHASE_STATE_MAP[phase];
  }

  // ─── Internal helpers ──────────────────────────────────────────────────

  /**
   * Extract a human-readable title from the change's proposal or name.
   */
  private static extractTitle(change: SddChange): string {
    const proposal = change.artifacts.get("proposal");
    if (proposal) {
      // Try to extract the first markdown heading
      const headingMatch = /^#\s+(?:Proposal:\s*)?(.+)$/m.exec(
        proposal.content,
      );
      if (headingMatch?.[1]) {
        return headingMatch[1].trim();
      }
    }

    // Fallback: humanize the change name
    return change.name
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }

  /**
   * Build a description summarizing the change's SDD artifacts.
   */
  private static buildDescription(change: SddChange): string {
    const parts: string[] = [
      `SDD Change: ${change.name}`,
      `Latest Phase: ${change.latestPhase}`,
      `Artifacts: ${[...change.artifacts.keys()].join(", ")}`,
    ];

    if (change.tasks.length > 0) {
      const done = change.tasks.filter((t) => t.done).length;
      parts.push(`Tasks: ${done}/${change.tasks.length} complete`);
    }

    return parts.join("\n");
  }
}

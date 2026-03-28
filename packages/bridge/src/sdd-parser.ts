import type {
  EngramObservation,
  SddArtifact,
  SddChange,
  SddPhase,
  SddTask,
} from "./types.js";

const SDD_TOPIC_KEY_RE = /^sdd\/([^/]+)\/([^/]+)$/;

const VALID_PHASES = new Set<string>([
  "explore",
  "proposal",
  "spec",
  "design",
  "tasks",
  "apply-progress",
  "verify-report",
  "archive-report",
  "state",
]);

/**
 * Phase ordering for determining "latest phase" of a change.
 * Higher index = further along the SDD pipeline.
 */
const PHASE_ORDER: SddPhase[] = [
  "explore",
  "proposal",
  "spec",
  "design",
  "tasks",
  "apply-progress",
  "verify-report",
  "archive-report",
];

/**
 * Regex for markdown checkbox lines:
 *   - [ ] 1.1 Some task title
 *   - [x] 2.3 Another completed task
 */
const CHECKBOX_RE = /^[-*]\s+\[([ xX])\]\s+(?:\d+\.\d+\s+)?(.+)$/;

/**
 * Regex for R-XXX-NN requirement IDs.
 */
const REQUIREMENT_RE = /R-[A-Z]{2,5}-\d{2}/g;

/**
 * Parses SDD artifacts from Engram observations.
 */
export class SddParser {
  /**
   * Extract the change name from an SDD topic_key.
   * Returns `null` if the key doesn't match the `sdd/{change}/{phase}` pattern.
   *
   * @example SddParser.extractChangeName("sdd/kanon-engram-bridge/tasks") // "kanon-engram-bridge"
   */
  static extractChangeName(topicKey: string): string | null {
    const match = SDD_TOPIC_KEY_RE.exec(topicKey);
    return match?.[1] ?? null;
  }

  /**
   * Extract the phase from an SDD topic_key.
   * Returns `null` if the key doesn't match or the phase is unrecognized.
   *
   * @example SddParser.extractPhase("sdd/kanon-engram-bridge/spec") // "spec"
   */
  static extractPhase(topicKey: string): SddPhase | null {
    const match = SDD_TOPIC_KEY_RE.exec(topicKey);
    if (!match) return null;
    const phase = match[2];
    if (!phase || !VALID_PHASES.has(phase)) return null;
    return phase as SddPhase;
  }

  /**
   * Parse markdown checkbox lines into SddTask items.
   *
   * Handles:
   *   - [ ] Task title
   *   - [x] 1.2 Task title with numbering
   *   - [X] Also completed
   *
   * Lines between checkboxes are collected as `description` of the
   * preceding task.
   *
   * Returns an empty array (does NOT throw) for unparseable content.
   */
  static parseTasks(markdownContent: string): SddTask[] {
    const tasks: SddTask[] = [];
    if (!markdownContent) return tasks;

    const lines = markdownContent.split("\n");
    let currentTask: SddTask | null = null;
    const descriptionLines: string[] = [];

    for (const line of lines) {
      const match = CHECKBOX_RE.exec(line.trim());
      if (match) {
        // Flush previous task's description
        if (currentTask && descriptionLines.length > 0) {
          currentTask.description = descriptionLines.join("\n").trim();
          descriptionLines.length = 0;
        }

        const checkbox = match[1];
        const title = match[2];
        if (title) {
          currentTask = {
            title: title.trim(),
            done: checkbox === "x" || checkbox === "X",
          };
          tasks.push(currentTask);
        }
      } else if (currentTask) {
        // Non-checkbox line after a task — collect as description
        const trimmed = line.trim();
        if (trimmed.length > 0 && !trimmed.startsWith("## ")) {
          descriptionLines.push(trimmed);
        }
      }
    }

    // Flush final task's description
    if (currentTask && descriptionLines.length > 0) {
      currentTask.description = descriptionLines.join("\n").trim();
    }

    return tasks;
  }

  /**
   * Extract R-XXX-NN requirement IDs from content.
   *
   * @example SddParser.parseRequirements("Implements R-BRG-01 and R-BRG-02") // ["R-BRG-01", "R-BRG-02"]
   */
  static parseRequirements(content: string): string[] {
    if (!content) return [];
    const matches = content.match(REQUIREMENT_RE);
    return matches ? [...new Set(matches)] : [];
  }

  /**
   * Group observations into SddChange objects by change name.
   *
   * Only observations with valid `sdd/{change}/{phase}` topic_keys are included.
   * Observations without topic_keys or with non-SDD keys are silently skipped.
   */
  static groupByChange(observations: EngramObservation[]): SddChange[] {
    const changeMap = new Map<string, SddChange>();

    for (const obs of observations) {
      if (!obs.topic_key) continue;

      const changeName = SddParser.extractChangeName(obs.topic_key);
      const phase = SddParser.extractPhase(obs.topic_key);
      if (!changeName || !phase) continue;

      let change = changeMap.get(changeName);
      if (!change) {
        change = {
          name: changeName,
          artifacts: new Map(),
          tasks: [],
          latestPhase: phase,
        };
        changeMap.set(changeName, change);
      }

      const artifact: SddArtifact = {
        changeName,
        phase,
        observationId: obs.id,
        content: obs.content,
        createdAt: obs.created_at,
      };
      change.artifacts.set(phase, artifact);

      // Update latest phase based on pipeline ordering
      const currentIdx = PHASE_ORDER.indexOf(change.latestPhase);
      const newIdx = PHASE_ORDER.indexOf(phase);
      if (newIdx > currentIdx) {
        change.latestPhase = phase;
      }

      // Parse tasks if this is the tasks artifact
      if (phase === "tasks") {
        change.tasks = SddParser.parseTasks(obs.content);
      }
    }

    return [...changeMap.values()];
  }
}

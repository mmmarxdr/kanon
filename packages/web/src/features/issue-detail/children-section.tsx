import { useCallback } from "react";
import { type IssueState } from "@/stores/board-store";
import type { Issue } from "@/types/issue";
import { useI18n } from "@/hooks/use-i18n";

/** Color map for state badges in child rows. */
const STATE_COLORS: Record<IssueState, string> = {
  backlog: "bg-zinc-100 text-zinc-600",
  explore: "bg-sky-100 text-sky-700",
  propose: "bg-blue-100 text-blue-700",
  design: "bg-indigo-100 text-indigo-700",
  spec: "bg-purple-100 text-purple-700",
  tasks: "bg-amber-100 text-amber-700",
  apply: "bg-emerald-100 text-emerald-700",
  verify: "bg-teal-100 text-teal-700",
  archived: "bg-zinc-100 text-zinc-500",
};

interface ChildrenSectionProps {
  children: Issue[];
  onSelect: (issueKey: string) => void;
}

/**
 * Renders a list of child issues with key, title, state badge,
 * and SDD label tags. Clicking a row calls onSelect with the child's key.
 *
 * If there are no children the section is not rendered (returns null).
 */
export function ChildrenSection({
  children,
  onSelect,
}: ChildrenSectionProps) {
  const { t } = useI18n();
  if (children.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {t("issueDetail.children.subtasks")}
      </span>
      <ul className="flex flex-col gap-1" role="list">
        {children.map((child) => (
          <ChildRow key={child.id} issue={child} onSelect={onSelect} />
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Internal                                                           */
/* ------------------------------------------------------------------ */

function ChildRow({
  issue,
  onSelect,
}: {
  issue: Issue;
  onSelect: (issueKey: string) => void;
}) {
  const { t } = useI18n();
  const handleClick = useCallback(() => {
    onSelect(issue.key);
  }, [onSelect, issue.key]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect(issue.key);
      }
    },
    [onSelect, issue.key],
  );

  const sddLabels = issue.labels.filter((l) => l.startsWith("sdd:"));
  const stateColor = STATE_COLORS[issue.state] ?? "bg-zinc-700 text-zinc-300";

  return (
    <li
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className="flex items-center gap-2 rounded-md px-3 py-2
        hover:bg-secondary transition-colors cursor-pointer
        focus:outline-none focus:ring-1 focus:ring-primary"
    >
      {/* Issue key */}
      <span className="text-xs font-mono text-primary shrink-0">
        {issue.key}
      </span>

      {/* Title */}
      <span className="text-sm text-foreground truncate flex-1">
        {issue.title}
      </span>

      {/* SDD label tags */}
      {sddLabels.map((label) => (
        <span
          key={label}
          className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-semibold shrink-0"
        >
          {label}
        </span>
      ))}

      {/* State badge */}
      <span
        className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${stateColor}`}
      >
        {issue.state === "backlog"
          ? t("board.state.backlog")
          : issue.state === "explore"
            ? t("board.state.explore")
            : issue.state === "propose"
              ? t("board.state.propose")
              : issue.state === "design"
                ? t("board.state.design")
                : issue.state === "spec"
                  ? t("board.state.spec")
                  : issue.state === "tasks"
                    ? t("board.state.tasks")
                    : issue.state === "apply"
                      ? t("board.state.apply")
                      : issue.state === "verify"
                        ? t("board.state.verify")
                        : t("board.state.archived")}
      </span>
    </li>
  );
}

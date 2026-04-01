import { useRef } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { GroupSummary } from "@/types/issue";
import { type IssueState } from "@/stores/board-store";
import { humanizeGroupKey } from "@/lib/humanize-group-key";
import { useI18n } from "@/hooks/use-i18n";

/** Color mapping for state indicator dots. */
const STATE_COLORS: Record<IssueState, string> = {
  backlog: "bg-gray-400",
  explore: "bg-gray-500",
  propose: "bg-primary",
  design: "bg-primary",
  spec: "bg-primary",
  tasks: "bg-blue-500",
  apply: "bg-blue-500",
  verify: "bg-amber-500",
  archived: "bg-emerald-500",
};

interface GroupCardProps {
  group: GroupSummary;
  onClick?: (groupKey: string, element: HTMLElement) => void;
}

export function GroupCard({ group, onClick }: GroupCardProps) {
  const { t } = useI18n();
  const cardRef = useRef<HTMLDivElement>(null);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `group:${group.groupKey}` });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const setRefs = (node: HTMLDivElement | null) => {
    setNodeRef(node);
    (cardRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
  };

  const handleClick = () => {
    if (!isDragging && onClick && cardRef.current) {
      onClick(group.groupKey, cardRef.current);
    }
  };

  const displayTitle = group.title || humanizeGroupKey(group.groupKey);
  const latestStateLabel =
    group.latestState === "backlog"
      ? t("board.state.backlog")
      : group.latestState === "explore"
        ? t("board.state.explore")
        : group.latestState === "propose"
          ? t("board.state.propose")
          : group.latestState === "design"
            ? t("board.state.design")
            : group.latestState === "spec"
              ? t("board.state.spec")
              : group.latestState === "tasks"
                ? t("board.state.tasks")
                : group.latestState === "apply"
                  ? t("board.state.apply")
                  : group.latestState === "verify"
                    ? t("board.state.verify")
                    : t("board.state.archived");

  return (
    <div
      ref={setRefs}
      style={style}
      {...attributes}
      {...listeners}
      data-testid={`group-card-${group.groupKey}`}
      onClick={handleClick}
      className={`rounded-md bg-surface-container-lowest p-4
        cursor-grab active:cursor-grabbing
        hover:bg-primary-fixed/20 transition-all duration-200 ease-out
        animate-fade-in
        ${isDragging ? "opacity-50 scale-[1.02] shadow-[var(--shadow-drag)]" : ""}`}
    >
      {/* Top row: group icon + count badge */}
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-violet-50 text-violet-600 text-[10px] font-bold">
          G
        </span>
        <span className="text-xs text-on-surface/50 font-mono tracking-wide truncate max-w-[120px]">
          {group.groupKey}
        </span>
        <span
          className="ml-auto inline-flex items-center justify-center px-1.5 py-0.5 rounded-md bg-primary-container text-on-primary-container text-[10px] font-semibold"
          title={`${group.count} ${group.count === 1 ? t("backlog.issuesOne") : t("backlog.issuesOther")} ${t("board.group.inGroup")}`}
        >
          {group.count}
        </span>
      </div>

      {/* Title */}
      <p className="text-[0.875rem] font-medium text-on-surface leading-snug line-clamp-2 mt-4">
        {displayTitle}
      </p>

      {/* Bottom row: state indicator */}
      <div className="flex items-center gap-1.5 mt-4">
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full ${STATE_COLORS[group.latestState] ?? "bg-gray-400"}`}
        />
        <span className="text-[0.6875rem] text-on-surface/50 tracking-wide">
          {latestStateLabel}
        </span>
      </div>
    </div>
  );
}

import { useRef } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Issue, IssuePriority, IssueType } from "@/types/issue";

/** Color mapping for priority indicator dots with glow aura. */
const PRIORITY_COLORS: Record<IssuePriority, string> = {
  critical: "bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.3)]",
  high: "bg-orange-400 shadow-[0_0_4px_rgba(251,146,60,0.3)]",
  medium: "bg-yellow-400 shadow-[0_0_4px_rgba(250,204,21,0.3)]",
  low: "bg-gray-400 shadow-[0_0_4px_rgba(156,163,175,0.3)]",
};

/** Icon labels for issue types. */
const TYPE_ICONS: Record<IssueType, string> = {
  feature: "F",
  bug: "B",
  task: "T",
  spike: "S",
};

const TYPE_COLORS: Record<IssueType, string> = {
  feature: "bg-primary/10 text-primary",
  bug: "bg-red-50 text-red-600",
  task: "bg-secondary text-muted-foreground",
  spike: "bg-violet-50 text-violet-600",
};

interface IssueCardProps {
  issue: Issue;
  onSelect?: (key: string, element: HTMLElement) => void;
}

export function IssueCard({ issue, onSelect }: IssueCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: issue.key });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const setRefs = (node: HTMLDivElement | null) => {
    setNodeRef(node);
    (cardRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
  };

  const handleClick = () => {
    if (!isDragging && onSelect && cardRef.current) {
      onSelect(issue.key, cardRef.current);
    }
  };

  return (
    <div
      ref={setRefs}
      style={style}
      {...attributes}
      {...listeners}
      data-testid={`issue-card-${issue.key}`}
      onClick={handleClick}
      className={`rounded-md bg-surface-container-lowest p-4
        cursor-grab active:cursor-grabbing
        hover:bg-primary-fixed/20 transition-all duration-200 ease-out
        animate-fade-in
        ${isDragging ? "opacity-50 scale-[1.02] shadow-[var(--shadow-drag)]" : ""}`}
    >
      {/* Top row: key + type badge */}
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold ${TYPE_COLORS[issue.type]}`}
        >
          {TYPE_ICONS[issue.type]}
        </span>
        <span className="text-xs text-primary font-mono tracking-wide">
          {issue.key}
        </span>
        {issue.children && issue.children.length > 0 && (
          <span
            className="ml-1 inline-flex items-center justify-center px-1.5 py-0.5 rounded-md bg-primary-container text-on-primary-container text-[10px] font-semibold"
            title={`${issue.children.length} child issue${issue.children.length === 1 ? "" : "s"}`}
          >
            {issue.children.length}
          </span>
        )}
        <span
          className={`ml-auto inline-block w-1.5 h-1.5 rounded-full ${PRIORITY_COLORS[issue.priority]}`}
          title={issue.priority}
        />
      </div>

      {/* Title */}
      <p className="text-[0.875rem] font-medium text-on-surface leading-snug line-clamp-2 mt-4">
        {issue.title}
      </p>

      {/* Bottom row: labels + assignee */}
      <div className="flex items-center gap-1.5 flex-wrap mt-4">
        {issue.labels.filter((l) => l.startsWith("sdd:")).map((label) => (
          <span
            key={label}
            className="text-[0.6875rem] uppercase tracking-wider px-1.5 py-0.5 rounded-md outline outline-1 outline-outline-variant/20 text-primary font-medium"
          >
            {label}
          </span>
        ))}
        {issue.labels.filter((l) => !l.startsWith("sdd:")).slice(0, 3).map((label) => (
          <span
            key={label}
            className="text-[0.6875rem] uppercase tracking-wider px-1.5 py-0.5 rounded-md outline outline-1 outline-outline-variant/20 text-on-surface/60 font-medium"
          >
            {label}
          </span>
        ))}
        {issue.assignee && (
          <span className="ml-auto text-[0.6875rem] text-on-surface/50 tracking-wide">
            {issue.assignee.username}
          </span>
        )}
      </div>
    </div>
  );
}

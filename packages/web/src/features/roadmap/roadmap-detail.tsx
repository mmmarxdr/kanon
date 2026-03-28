import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { FocusTrap } from "focus-trap-react";
import type { RoadmapItem, RoadmapDependency, Horizon, RoadmapStatus } from "@/types/roadmap";
import {
  useRoadmapQuery,
  useUpdateRoadmapMutation,
  useDeleteRoadmapMutation,
  usePromoteRoadmapMutation,
  useAddDependencyMutation,
  useRemoveDependencyMutation,
} from "./use-roadmap-query";
import { HORIZON_LABELS } from "@/stores/roadmap-store";

interface RoadmapDetailProps {
  item: RoadmapItem;
  projectKey: string;
  onClose: () => void;
}

const HORIZON_OPTIONS: Horizon[] = ["someday", "later", "next", "now"];
const SCORE_OPTIONS = [1, 2, 3, 4, 5];

export function RoadmapDetail({
  item,
  projectKey,
  onClose,
}: RoadmapDetailProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const updateMutation = useUpdateRoadmapMutation(projectKey, item.id);
  const deleteMutation = useDeleteRoadmapMutation(projectKey);
  const promoteMutation = usePromoteRoadmapMutation(projectKey);
  const addDependencyMutation = useAddDependencyMutation(projectKey, item.id);
  const removeDependencyMutation = useRemoveDependencyMutation(projectKey, item.id);

  // All roadmap items for the dependency picker
  const { data: allItems } = useRoadmapQuery(projectKey);
  const [depSearch, setDepSearch] = useState("");
  const [showDepDropdown, setShowDepDropdown] = useState(false);
  const depInputRef = useRef<HTMLInputElement>(null);

  // Items available to add as dependencies (exclude self and already linked)
  const availableItems = useMemo(() => {
    if (!allItems) return [];
    const linkedIds = new Set([
      item.id,
      ...(item.blocks ?? []).map((d) => d.targetId),
      ...(item.dependsOn ?? []).map((d) => d.sourceId),
    ]);
    let filtered = allItems.filter((i) => !linkedIds.has(i.id));
    if (depSearch) {
      const lower = depSearch.toLowerCase();
      filtered = filtered.filter((i) => i.title.toLowerCase().includes(lower));
    }
    return filtered.slice(0, 10);
  }, [allItems, item.id, item.blocks, item.dependsOn, depSearch]);

  const handleAddDependency = useCallback(
    (targetId: string) => {
      addDependencyMutation.mutate({ targetId });
      setDepSearch("");
      setShowDepDropdown(false);
    },
    [addDependencyMutation],
  );

  const handleRemoveDependency = useCallback(
    (depId: string) => {
      removeDependencyMutation.mutate(depId);
    },
    [removeDependencyMutation],
  );

  // Inline editing state
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(item.title);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState(
    item.description ?? "",
  );
  const titleInputRef = useRef<HTMLInputElement>(null);
  const descTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync drafts when item changes
  useEffect(() => {
    if (!isEditingTitle) setTitleDraft(item.title);
  }, [item.title, isEditingTitle]);

  useEffect(() => {
    if (!isEditingDescription) setDescriptionDraft(item.description ?? "");
  }, [item.description, isEditingDescription]);

  // Auto-focus on edit mode
  useEffect(() => {
    if (isEditingTitle) titleInputRef.current?.focus();
  }, [isEditingTitle]);

  useEffect(() => {
    if (isEditingDescription) descTextareaRef.current?.focus();
  }, [isEditingDescription]);

  // Escape key handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleTitleSave = useCallback(() => {
    setIsEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== item.title) {
      updateMutation.mutate({ title: trimmed });
    }
  }, [titleDraft, item.title, updateMutation]);

  const handleDescriptionSave = useCallback(() => {
    setIsEditingDescription(false);
    const trimmed = descriptionDraft.trim();
    const original = (item.description ?? "").trim();
    if (trimmed !== original) {
      updateMutation.mutate({ description: trimmed || null });
    }
  }, [descriptionDraft, item.description, updateMutation]);

  const handleHorizonChange = useCallback(
    (horizon: Horizon) => {
      updateMutation.mutate({ horizon });
    },
    [updateMutation],
  );

  const handleEffortChange = useCallback(
    (effort: number) => {
      updateMutation.mutate({ effort });
    },
    [updateMutation],
  );

  const handleImpactChange = useCallback(
    (impact: number) => {
      updateMutation.mutate({ impact });
    },
    [updateMutation],
  );

  const handleTargetDateChange = useCallback(
    (value: string) => {
      updateMutation.mutate({ targetDate: value || null });
    },
    [updateMutation],
  );

  const handleDelete = useCallback(() => {
    if (confirm("Delete this roadmap item?")) {
      deleteMutation.mutate(item.id, {
        onSuccess: () => onClose(),
      });
    }
  }, [deleteMutation, item.id, onClose]);

  const handlePromote = useCallback(() => {
    promoteMutation.mutate({ itemId: item.id });
  }, [promoteMutation, item.id]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  return (
    <FocusTrap
      focusTrapOptions={{
        escapeDeactivates: false,
        allowOutsideClick: true,
        clickOutsideDeactivates: false,
      }}
    >
      <div
        className="fixed inset-0 z-50 flex justify-end"
        onClick={handleBackdropClick}
      >
        {/* Semi-transparent backdrop */}
        <div
          className="absolute inset-0 bg-black/20 animate-fade-in"
          aria-hidden="true"
        />

        {/* Slide-in panel */}
        <div
          ref={panelRef}
          data-testid="roadmap-detail-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="roadmap-detail-title"
          className="relative w-[60vw] max-w-4xl min-w-[320px]
            max-md:w-full
            h-full bg-card border-l border-border shadow-lg
            overflow-y-auto
            animate-slide-in-right"
        >
          <div className="flex flex-col gap-5 p-5">
            {/* Header: title + close */}
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                {isEditingTitle ? (
                  <input
                    ref={titleInputRef}
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onBlur={handleTitleSave}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleTitleSave();
                      if (e.key === "Escape") {
                        e.stopPropagation();
                        setTitleDraft(item.title);
                        setIsEditingTitle(false);
                      }
                    }}
                    className="w-full text-lg font-semibold text-foreground bg-transparent border-b border-primary outline-none"
                    aria-label="Roadmap item title"
                  />
                ) : (
                  <h2
                    id="roadmap-detail-title"
                    className="text-lg font-semibold text-foreground cursor-text truncate"
                    onClick={() => setIsEditingTitle(true)}
                  >
                    {item.title}
                  </h2>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors shrink-0"
                aria-label="Close panel"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  className="w-4 h-4"
                >
                  <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
                </svg>
              </button>
            </div>

            {/* Description */}
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Description
              </span>
              {isEditingDescription ? (
                <textarea
                  ref={descTextareaRef}
                  value={descriptionDraft}
                  onChange={(e) => setDescriptionDraft(e.target.value)}
                  onBlur={handleDescriptionSave}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      setDescriptionDraft(item.description ?? "");
                      setIsEditingDescription(false);
                    }
                  }}
                  rows={6}
                  className="w-full rounded border border-border bg-secondary px-3 py-2
                    text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/30
                    resize-y min-h-[6rem]"
                  placeholder="Add a description..."
                  aria-label="Roadmap item description"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setIsEditingDescription(true)}
                  className="w-full text-left rounded px-3 py-2 min-h-[3rem]
                    hover:bg-secondary transition-colors cursor-text"
                >
                  {item.description ? (
                    <p className="text-sm text-foreground whitespace-pre-wrap">
                      {item.description}
                    </p>
                  ) : (
                    <span className="text-sm text-muted-foreground italic">
                      Click to add a description...
                    </span>
                  )}
                </button>
              )}
            </div>

            {/* Metadata fields */}
            <div className="grid grid-cols-2 gap-4">
              {/* Horizon */}
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Horizon
                </span>
                <select
                  value={item.horizon}
                  onChange={(e) =>
                    handleHorizonChange(e.target.value as Horizon)
                  }
                  className="rounded border border-border bg-secondary px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                >
                  {HORIZON_OPTIONS.map((h) => (
                    <option key={h} value={h}>
                      {HORIZON_LABELS[h]}
                    </option>
                  ))}
                </select>
              </div>

              {/* Effort */}
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Effort (1-5)
                </span>
                <select
                  value={item.effort ?? ""}
                  onChange={(e) =>
                    handleEffortChange(Number(e.target.value))
                  }
                  className="rounded border border-border bg-secondary px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                >
                  <option value="">Unset</option>
                  {SCORE_OPTIONS.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>

              {/* Impact */}
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Impact (1-5)
                </span>
                <select
                  value={item.impact ?? ""}
                  onChange={(e) =>
                    handleImpactChange(Number(e.target.value))
                  }
                  className="rounded border border-border bg-secondary px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                >
                  <option value="">Unset</option>
                  {SCORE_OPTIONS.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>

              {/* Labels */}
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Labels
                </span>
                <div className="flex items-center gap-1 flex-wrap min-h-[2rem]">
                  {item.labels.map((label) => (
                    <span
                      key={label}
                      className="text-[11px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground"
                    >
                      {label}
                    </span>
                  ))}
                  {item.labels.length === 0 && (
                    <span className="text-xs text-muted-foreground italic">
                      No labels
                    </span>
                  )}
                </div>
              </div>

              {/* Target Date */}
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Target Date
                </span>
                <input
                  type="date"
                  value={
                    item.targetDate
                      ? new Date(item.targetDate).toISOString().split("T")[0]
                      : ""
                  }
                  onChange={(e) => handleTargetDateChange(e.target.value)}
                  className="rounded border border-border bg-secondary px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                />
              </div>
            </div>

            {/* Dependencies */}
            <div className="flex flex-col gap-3">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Dependencies
              </span>

              {/* Blocks list */}
              {(item.blocks ?? []).length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    Blocks
                  </span>
                  {(item.blocks ?? []).map((dep) => (
                    <DependencyEntry
                      key={dep.id}
                      title={dep.target?.title ?? "Unknown"}
                      status={dep.target?.status ?? "idea"}
                      onRemove={() => handleRemoveDependency(dep.id)}
                    />
                  ))}
                </div>
              )}

              {/* Blocked by list */}
              {(item.dependsOn ?? []).length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    Blocked by
                  </span>
                  {(item.dependsOn ?? []).map((dep) => (
                    <DependencyEntry
                      key={dep.id}
                      title={dep.source?.title ?? "Unknown"}
                      status={dep.source?.status ?? "idea"}
                      onRemove={() => handleRemoveDependency(dep.id)}
                    />
                  ))}
                </div>
              )}

              {(item.blocks ?? []).length === 0 &&
                (item.dependsOn ?? []).length === 0 && (
                  <span className="text-xs text-muted-foreground italic">
                    No dependencies
                  </span>
                )}

              {/* Add dependency control */}
              <div className="relative">
                <input
                  ref={depInputRef}
                  type="text"
                  value={depSearch}
                  onChange={(e) => {
                    setDepSearch(e.target.value);
                    setShowDepDropdown(true);
                  }}
                  onFocus={() => setShowDepDropdown(true)}
                  onBlur={() => {
                    // Delay to allow click on dropdown items
                    setTimeout(() => setShowDepDropdown(false), 200);
                  }}
                  placeholder="Add dependency... (this item blocks)"
                  className="w-full rounded border border-border bg-secondary px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                />
                {showDepDropdown && availableItems.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto rounded border border-border bg-card shadow-lg">
                    {availableItems.map((candidate) => (
                      <button
                        key={candidate.id}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleAddDependency(candidate.id)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-secondary transition-colors flex items-center gap-2"
                      >
                        <span className="truncate flex-1">
                          {candidate.title}
                        </span>
                        <StatusBadge status={candidate.status} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Timestamps */}
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span>
                Created:{" "}
                {new Date(item.createdAt).toLocaleDateString()}
              </span>
              <span>
                Updated:{" "}
                {new Date(item.updatedAt).toLocaleDateString()}
              </span>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-2 border-t border-border">
              {!item.promoted && (
                <button
                  type="button"
                  onClick={handlePromote}
                  disabled={promoteMutation.isPending}
                  className="px-3 py-1.5 text-sm font-medium rounded bg-primary text-primary-foreground
                    hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {promoteMutation.isPending
                    ? "Promoting..."
                    : "Promote to Issue"}
                </button>
              )}
              {item.promoted && (
                <span className="text-sm text-emerald-600 font-medium">
                  Already promoted
                </span>
              )}
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
                className="px-3 py-1.5 text-sm font-medium rounded border border-border text-destructive-foreground
                  hover:bg-destructive/10 transition-colors disabled:opacity-50 ml-auto"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>
    </FocusTrap>
  );
}

/** Status color mapping for dependency badges. */
const DEP_STATUS_COLORS: Record<RoadmapStatus, string> = {
  idea: "bg-gray-100 text-gray-600",
  planned: "bg-blue-50 text-blue-600",
  in_progress: "bg-amber-50 text-amber-600",
  done: "bg-emerald-50 text-emerald-600",
};

const DEP_STATUS_LABELS: Record<RoadmapStatus, string> = {
  idea: "Idea",
  planned: "Planned",
  in_progress: "In Progress",
  done: "Done",
};

function StatusBadge({ status }: { status: RoadmapStatus }) {
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 ${DEP_STATUS_COLORS[status]}`}
    >
      {DEP_STATUS_LABELS[status]}
    </span>
  );
}

function DependencyEntry({
  title,
  status,
  onRemove,
}: {
  title: string;
  status: RoadmapStatus;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded bg-secondary/50 px-2 py-1.5">
      <span className="text-sm text-foreground truncate flex-1">{title}</span>
      <StatusBadge status={status} />
      <button
        type="button"
        onClick={onRemove}
        className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors shrink-0"
        aria-label={`Remove dependency: ${title}`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="currentColor"
          className="w-3.5 h-3.5"
        >
          <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
        </svg>
      </button>
    </div>
  );
}

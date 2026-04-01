import { useState, useCallback, useEffect, useRef } from "react";
import { FocusTrap } from "focus-trap-react";
import { useCreateRoadmapMutation } from "./use-roadmap-query";
import type { Horizon } from "@/types/roadmap";
import { useI18n } from "@/hooks/use-i18n";

interface NewRoadmapItemModalProps {
  projectKey: string;
  defaultHorizon?: Horizon;
  onClose: () => void;
}

/**
 * Modal for creating a new roadmap item.
 *
 * Features:
 * - FocusTrap for accessibility
 * - Escape key to close
 * - Enter in title submits (if title not empty)
 * - Loading state on Create button during mutation
 * - Semi-transparent backdrop (click to close)
 */
export function NewRoadmapItemModal({
  projectKey,
  defaultHorizon = "later",
  onClose,
}: NewRoadmapItemModalProps) {
  const { t } = useI18n();
  const titleRef = useRef<HTMLInputElement>(null);
  const createMutation = useCreateRoadmapMutation(projectKey);
  const HORIZON_OPTIONS: { value: Horizon; label: string }[] = [
    { value: "someday", label: t("roadmap.horizon.someday") },
    { value: "later", label: t("roadmap.horizon.later") },
    { value: "next", label: t("roadmap.horizon.next") },
    { value: "now", label: t("roadmap.horizon.now") },
  ];


  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [horizon, setHorizon] = useState<Horizon>(defaultHorizon);
  const [effort, setEffort] = useState("");
  const [impact, setImpact] = useState("");
  const [labels, setLabels] = useState("");
  const [targetDate, setTargetDate] = useState("");

  // Auto-focus title
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  // Escape key handler
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
        horizon,
        effort: effort ? Number(effort) : undefined,
        impact: impact ? Number(impact) : undefined,
        labels: parsedLabels.length > 0 ? parsedLabels : undefined,
        targetDate: targetDate || undefined,
      },
      {
        onSuccess: () => {
          onClose();
        },
      },
    );
  }, [title, description, horizon, effort, impact, labels, targetDate, createMutation, onClose]);

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
      }}
    >
      <div
        className="fixed inset-0 z-50 flex items-center justify-center"
        onClick={handleBackdropClick}
      >
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/20 animate-fade-in"
          aria-hidden="true"
        />

        {/* Modal */}
        <div
          data-testid="new-roadmap-item-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-roadmap-title"
          className="relative w-full max-w-lg bg-card rounded-lg border border-border shadow-lg p-5 mx-4 animate-fade-in"
        >
          <h2
            id="new-roadmap-title"
            className="text-base font-semibold text-foreground mb-4"
          >
            {t("roadmap.modal.newItemTitle")}
          </h2>

          <div className="flex flex-col gap-3">
            {/* Title */}
            <input
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit();
              }}
              placeholder={t("roadmap.modal.fieldTitle")}
              className="w-full rounded border border-border bg-secondary px-3 py-2
                text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            />

            {/* Description */}
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("roadmap.modal.fieldDescriptionOptional")}
              rows={3}
              className="w-full rounded border border-border bg-secondary px-3 py-2
                text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/30
                resize-y"
            />

            {/* Horizon + Effort + Impact row */}
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {t("roadmap.modal.fieldHorizon")}
                </label>
                <select
                  value={horizon}
                  onChange={(e) => setHorizon(e.target.value as Horizon)}
                  className="rounded border border-border bg-secondary px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                >
                  {HORIZON_OPTIONS.map((h) => (
                    <option key={h.value} value={h.value}>
                      {h.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {t("roadmap.modal.fieldEffort")}
                </label>
                <select
                  value={effort}
                  onChange={(e) => setEffort(e.target.value)}
                  className="rounded border border-border bg-secondary px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                >
                  <option value="">-</option>
                  {[1, 2, 3, 4, 5].map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {t("roadmap.modal.fieldImpact")}
                </label>
                <select
                  value={impact}
                  onChange={(e) => setImpact(e.target.value)}
                  className="rounded border border-border bg-secondary px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                >
                  <option value="">-</option>
                  {[1, 2, 3, 4, 5].map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Labels */}
            <input
              value={labels}
              onChange={(e) => setLabels(e.target.value)}
              placeholder={t("roadmap.modal.fieldLabelsComma")}
              className="w-full rounded border border-border bg-secondary px-3 py-2
                text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            />

            {/* Target Date */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {t("roadmap.modal.fieldTargetDate")}
              </label>
              <input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className="w-full rounded border border-border bg-secondary px-3 py-2
                  text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 mt-5">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm font-medium rounded border border-border
                text-muted-foreground hover:bg-secondary transition-colors"
            >
              {t("roadmap.modal.cancel")}
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!title.trim() || createMutation.isPending}
              className="px-3 py-1.5 text-sm font-medium rounded bg-primary text-primary-foreground
                hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {createMutation.isPending
                ? t("roadmap.modal.creating")
                : t("roadmap.modal.create")}
            </button>
          </div>
        </div>
      </div>
    </FocusTrap>
  );
}

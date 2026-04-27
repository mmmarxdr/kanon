import { useState, useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FocusTrap } from "focus-trap-react";
import {
  useCloseCycleMutation,
  useAttachIssueMutation,
  useDetachIssueMutation,
} from "./use-cycle-mutations";
import { invalidateAfterCycleMembership } from "@/lib/cache-mutations";
import { useToastStore } from "@/stores/toast-store";
import type { CycleDetail, Cycle } from "@/types/cycle";

// ---------------------------------------------------------------------------
// Disposition type
// ---------------------------------------------------------------------------

type Disposition = "move-next" | "move-backlog" | "leave";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CloseCycleDialogProps {
  /** The active cycle being closed — must include its issues array. */
  cycle: CycleDetail;
  /** All project cycles, used to find the nearest upcoming cycle. */
  cycles: Cycle[];
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Style constants (matching create-cycle-modal / cycles-view patterns)
// ---------------------------------------------------------------------------

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 10,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--ink-4)",
  marginBottom: 4,
  fontFamily: "JetBrains Mono, monospace",
};

const radioRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 10,
  padding: "10px 12px",
  borderRadius: 5,
  border: "1px solid var(--line)",
  background: "var(--bg-2)",
  cursor: "pointer",
  transition: "border-color 0.1s",
};

// ---------------------------------------------------------------------------
// CloseCycleDialog
// ---------------------------------------------------------------------------

export function CloseCycleDialog({ cycle, cycles, onClose }: CloseCycleDialogProps) {
  const projectKey = cycle.projectId; // used as cache-key for invalidation (see D5)
  const queryClient = useQueryClient();
  const closeMutation = useCloseCycleMutation(cycle.id, projectKey);
  const attachMutation = useAttachIssueMutation(projectKey);
  const detachMutation = useDetachIssueMutation(projectKey);

  const incompleteIssues = cycle.issues.filter((i) => i.state !== "done");
  const hasIncomplete = incompleteIssues.length > 0;

  // The nearest upcoming cycle by startDate, or null if none
  const nextCycle: Cycle | null =
    cycles
      .filter((c) => c.state === "upcoming" && c.id !== cycle.id)
      .sort(
        (a, b) =>
          new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
      )[0] ?? null;

  const [disposition, setDisposition] = useState<Disposition>(
    hasIncomplete ? "move-backlog" : "leave",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  const handleConfirm = useCallback(async () => {
    setIsSubmitting(true);
    setError(null);

    try {
      // Step 1: Apply disposition (only when there are incomplete issues)
      if (hasIncomplete) {
        if (disposition === "move-backlog") {
          // Detach all incomplete issues from current cycle
          for (const issue of incompleteIssues) {
            await detachMutation.mutateAsync({
              cycleId: cycle.id,
              issueKey: issue.key,
              reason: "cycle-closed-move-backlog",
              context: "cycles-view",
              skipInvalidation: true,
            });
          }
        } else if (disposition === "move-next" && nextCycle) {
          // Detach from current, then attach to next
          for (const issue of incompleteIssues) {
            await detachMutation.mutateAsync({
              cycleId: cycle.id,
              issueKey: issue.key,
              reason: "cycle-closed-move-next",
              context: "cycles-view",
              skipInvalidation: true,
            });
          }
          for (const issue of incompleteIssues) {
            await attachMutation.mutateAsync({
              cycleId: nextCycle.id,
              issueKey: issue.key,
              reason: "cycle-closed-moved-from-previous",
              context: "cycles-view",
              skipInvalidation: true,
            });
          }
        }
        // "leave" disposition: no issue changes needed
      }

      // Single invalidation pass after the loop, before close.
      // The per-issue mutations ran with skipInvalidation: true above, so
      // this is the ONLY invalidation for cycle membership in this flow.
      // useCloseCycleMutation.onSuccess will fire its own invalidation after.
      if (hasIncomplete) {
        invalidateAfterCycleMembership(queryClient, {
          cycleId: cycle.id,
          issueKey: "", // batch-mode: no single issue is the focus
          projectKey,
          context: "cycles-view",
        });
      }

      // Step 2: Close the cycle (only after disposition succeeds)
      await closeMutation.mutateAsync();
      onClose();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "An unexpected error occurred.";
      setError(`Failed to close cycle: ${msg}`);
      setIsSubmitting(false);
    }
  }, [
    hasIncomplete,
    disposition,
    incompleteIssues,
    cycle.id,
    nextCycle,
    detachMutation,
    attachMutation,
    closeMutation,
    onClose,
  ]);

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
          aria-labelledby="close-cycle-dialog-title"
          data-testid="close-cycle-dialog"
          style={{
            position: "relative",
            width: "100%",
            maxWidth: 440,
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
              id="close-cycle-dialog-title"
              className="mono"
              style={{
                fontSize: 10.5,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--ink-4)",
              }}
            >
              Close cycle
            </span>
            <span style={{ fontSize: 12, color: "var(--ink-2)", marginLeft: 4 }}>
              {cycle.name}
            </span>
          </div>

          {/* Body */}
          <div style={{ padding: "16px 16px 14px", display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Incomplete count summary */}
            <div
              style={{
                padding: "10px 12px",
                borderRadius: 5,
                background: "var(--bg)",
                border: "1px solid var(--line)",
                fontSize: 12.5,
                color: "var(--ink-2)",
              }}
            >
              {hasIncomplete ? (
                <span data-testid="close-cycle-incomplete-count">
                  <strong data-testid="incomplete-count-value">
                    {incompleteIssues.length} incomplete
                  </strong>{" "}
                  {incompleteIssues.length === 1 ? "issue" : "issues"} will not move to{" "}
                  <strong>done</strong>. Choose how to handle {incompleteIssues.length === 1 ? "it" : "them"}:
                </span>
              ) : (
                <span>All issues are done. Ready to close.</span>
              )}
            </div>

            {/* Disposition options — only shown when there are incomplete issues */}
            {hasIncomplete && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={labelStyle}>Disposition</span>

                {/* Move to next cycle */}
                <label
                  style={{
                    ...radioRowStyle,
                    opacity: !nextCycle ? 0.5 : 1,
                    cursor: !nextCycle ? "not-allowed" : "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name="disposition"
                    value="move-next"
                    checked={disposition === "move-next"}
                    disabled={!nextCycle}
                    onChange={() => setDisposition("move-next")}
                    data-testid="disposition-move-next"
                    style={{ marginTop: 2 }}
                  />
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--ink)" }}>
                      Move to next cycle
                    </span>
                    {nextCycle ? (
                      <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
                        Attach to <strong>{nextCycle.name}</strong> and detach from this cycle
                      </span>
                    ) : (
                      <span
                        style={{ fontSize: 11, color: "var(--ink-4)" }}
                        data-testid="move-next-disabled-hint"
                      >
                        No upcoming cycle exists in this project
                      </span>
                    )}
                  </div>
                </label>

                {/* Move to backlog */}
                <label style={radioRowStyle}>
                  <input
                    type="radio"
                    name="disposition"
                    value="move-backlog"
                    checked={disposition === "move-backlog"}
                    onChange={() => setDisposition("move-backlog")}
                    data-testid="disposition-move-backlog"
                    style={{ marginTop: 2 }}
                  />
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--ink)" }}>
                      Move to backlog
                    </span>
                    <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
                      Detach all incomplete issues from this cycle (no new cycle attached)
                    </span>
                  </div>
                </label>

                {/* Leave attached */}
                <label style={radioRowStyle}>
                  <input
                    type="radio"
                    name="disposition"
                    value="leave"
                    checked={disposition === "leave"}
                    onChange={() => setDisposition("leave")}
                    data-testid="disposition-leave"
                    style={{ marginTop: 2 }}
                  />
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--ink)" }}>
                      Leave attached
                    </span>
                    <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
                      Keep incomplete issues attached to this closed cycle
                    </span>
                  </div>
                </label>
              </div>
            )}

            {/* Error message */}
            {error && (
              <div
                data-testid="close-cycle-error"
                style={{
                  padding: "8px 12px",
                  borderRadius: 5,
                  background: "color-mix(in oklch, var(--bad) 12%, transparent)",
                  border: "1px solid color-mix(in oklch, var(--bad) 30%, transparent)",
                  fontSize: 12,
                  color: "var(--bad)",
                }}
              >
                {error}
              </div>
            )}
          </div>

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
            <span className="mono" style={{ fontSize: 10.5, color: "var(--ink-4)" }}>
              Esc to close
            </span>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              style={{
                height: 28,
                padding: "0 12px",
                border: "1px solid var(--line)",
                borderRadius: 4,
                background: "var(--panel)",
                color: "var(--ink-2)",
                fontSize: 12,
                opacity: isSubmitting ? 0.55 : 1,
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={isSubmitting}
              data-testid="close-cycle-confirm"
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
                opacity: isSubmitting ? 0.55 : 1,
                cursor: isSubmitting ? "not-allowed" : "pointer",
              }}
            >
              {isSubmitting ? "Closing…" : "Close cycle"}
            </button>
          </div>
        </div>
      </div>
    </FocusTrap>
  );
}

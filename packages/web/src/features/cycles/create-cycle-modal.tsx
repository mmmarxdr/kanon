import { useState, useCallback, useEffect } from "react";
import { FocusTrap } from "focus-trap-react";
import { useCreateCycleMutation } from "./use-cycle-mutations";
import { Icon } from "@/components/ui/icons";

const MAX_NAME_LENGTH = 120;

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 10,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--ink-4)",
  marginBottom: 4,
  fontFamily: "JetBrains Mono, monospace",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 32,
  padding: "0 10px",
  background: "var(--bg)",
  border: "1px solid var(--line)",
  borderRadius: 5,
  color: "var(--ink)",
  fontSize: 12.5,
  outline: "none",
};

interface CreateCycleModalProps {
  projectKey: string;
  onClose: () => void;
}

export function CreateCycleModal({ projectKey, onClose }: CreateCycleModalProps) {
  const createMutation = useCreateCycleMutation(projectKey);

  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // Validation
  const nameTrimmed = name.trim();
  const isNameValid = nameTrimmed.length > 0 && nameTrimmed.length <= MAX_NAME_LENGTH;
  const isDateValid = !!(
    startDate &&
    endDate &&
    new Date(endDate) > new Date(startDate)
  );
  const isValid = isNameValid && isDateValid;

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

  const handleSubmit = useCallback(() => {
    if (!isValid) return;

    createMutation.mutate(
      {
        name: nameTrimmed,
        goal: goal.trim() || undefined,
        startDate,
        endDate,
      },
      { onSuccess: () => onClose() },
    );
  }, [isValid, nameTrimmed, goal, startDate, endDate, createMutation, onClose]);

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
          aria-labelledby="new-cycle-title-label"
          data-testid="new-cycle-modal"
          style={{
            position: "relative",
            width: "100%",
            maxWidth: 480,
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
              id="new-cycle-title-label"
              className="mono"
              style={{
                fontSize: 10.5,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--ink-4)",
              }}
            >
              New cycle
            </span>
            <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
              · {projectKey}
            </span>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={{ color: "var(--ink-4)", padding: 2 }}
            >
              <Icon.X />
            </button>
          </div>

          {/* Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 14,
              padding: "16px 16px 14px",
            }}
          >
            {/* Name */}
            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  marginBottom: 4,
                }}
              >
                <label htmlFor="cycle-name" style={{ ...labelStyle, marginBottom: 0 }}>
                  Name <span style={{ color: "var(--bad)" }}>*</span>
                </label>
                <span
                  className="mono"
                  style={{
                    fontSize: 9.5,
                    color: nameTrimmed.length > MAX_NAME_LENGTH ? "var(--bad)" : "var(--ink-4)",
                  }}
                >
                  {nameTrimmed.length}/{MAX_NAME_LENGTH}
                </span>
              </div>
              <input
                id="cycle-name"
                type="text"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={MAX_NAME_LENGTH}
                placeholder="Sprint 1"
                data-testid="new-cycle-name"
                style={inputStyle}
              />
            </div>

            {/* Goal (optional) */}
            <div>
              <label htmlFor="cycle-goal" style={labelStyle}>
                Goal <span style={{ color: "var(--ink-4)", fontSize: 9 }}>(optional)</span>
              </label>
              <textarea
                id="cycle-goal"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                rows={2}
                placeholder="What do we want to ship?"
                data-testid="new-cycle-goal"
                style={{
                  width: "100%",
                  background: "var(--bg)",
                  border: "1px solid var(--line)",
                  borderRadius: 5,
                  padding: "8px 10px",
                  color: "var(--ink)",
                  fontSize: 12.5,
                  lineHeight: 1.5,
                  outline: "none",
                  resize: "vertical",
                  fontFamily: "inherit",
                }}
              />
            </div>

            {/* Dates row */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              <div>
                <label htmlFor="cycle-start-date" style={labelStyle}>
                  Start date <span style={{ color: "var(--bad)" }}>*</span>
                </label>
                <input
                  id="cycle-start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  required
                  data-testid="new-cycle-start-date"
                  style={inputStyle}
                />
              </div>
              <div>
                <label htmlFor="cycle-end-date" style={labelStyle}>
                  End date <span style={{ color: "var(--bad)" }}>*</span>
                </label>
                <input
                  id="cycle-end-date"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  required
                  data-testid="new-cycle-end-date"
                  style={inputStyle}
                />
              </div>
            </div>

            {/* Date validation error */}
            {startDate && endDate && !isDateValid && (
              <span
                style={{ fontSize: 11.5, color: "var(--bad)" }}
                role="alert"
                data-testid="new-cycle-date-error"
              >
                End date must be after start date.
              </span>
            )}
          </form>

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
              style={{
                height: 28,
                padding: "0 12px",
                border: "1px solid var(--line)",
                borderRadius: 4,
                background: "var(--panel)",
                color: "var(--ink-2)",
                fontSize: 12,
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!isValid || createMutation.isPending}
              data-testid="new-cycle-submit"
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
                opacity: !isValid || createMutation.isPending ? 0.55 : 1,
                cursor: !isValid || createMutation.isPending ? "not-allowed" : "pointer",
              }}
            >
              {createMutation.isPending ? "Creating…" : "Create cycle"}
            </button>
          </div>
        </div>
      </div>
    </FocusTrap>
  );
}

import { useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useEscapeKey } from "@/hooks/use-escape-key";
import { useBackdropClose } from "@/hooks/use-backdrop-close";
import { FocusTrap } from "focus-trap-react";

// ---------------------------------------------------------------------------
// Validation — mirrors the server's confirmedTotalHours rule (KAN-188):
// non-negative decimal string, at most 2 decimal places, capped at 744.
// ---------------------------------------------------------------------------

const HOURS_PATTERN = /^\d+(\.\d{1,2})?$/;
const MAX_HOURS = 744;

function parseAdjustedHours(raw: string): number | null {
  if (!HOURS_PATTERN.test(raw)) return null;
  const value = Number(raw);
  if (Number.isNaN(value) || value < 0 || value > MAX_HOURS) return null;
  return value;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ReconcileModalProps {
  /** The issue whose captured time is being reconciled. */
  issueKey: string;
  /** Captured hours reported by the server's 409 RECONCILIATION_REQUIRED payload. */
  totalHours: number;
  /** Called with the confirmed total (reported or adjusted) when the user confirms. */
  onConfirm: (confirmedTotalHours: number) => void;
  onClose: () => void;
  /** True while the reconcile-and-transition request is in flight. */
  isSubmitting?: boolean;
}

// ---------------------------------------------------------------------------
// ReconcileModal — confirm-or-adjust captured time before transitioning to done
// ---------------------------------------------------------------------------

export function ReconcileModal({
  issueKey,
  totalHours,
  onConfirm,
  onClose,
  isSubmitting = false,
}: ReconcileModalProps) {
  const { t } = useTranslation("board");
  const { t: tCommon } = useTranslation("common");
  const [rawValue, setRawValue] = useState(String(totalHours));

  useEscapeKey(onClose, !isSubmitting);
  const handleBackdropClick = useBackdropClose(onClose);

  const adjustedHours = useMemo(() => parseAdjustedHours(rawValue), [rawValue]);
  const isValid = adjustedHours !== null;

  const handleConfirm = () => {
    if (adjustedHours === null || isSubmitting) return;
    onConfirm(adjustedHours);
  };

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
          aria-labelledby="reconcile-modal-title"
          data-testid="reconcile-modal"
          style={{
            position: "relative",
            width: "100%",
            maxWidth: 380,
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
              id="reconcile-modal-title"
              className="mono"
              style={{
                fontSize: 10.5,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--ink-4)",
              }}
            >
              {t("reconcileTitle")}
            </span>
            <span style={{ fontSize: 12, color: "var(--ink-2)", marginLeft: 4 }}>
              {issueKey}
            </span>
          </div>

          {/* Body */}
          <div
            style={{
              padding: "16px 16px 14px",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
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
              <Trans
                i18nKey="reconcileBody"
                ns="board"
                values={{ hours: totalHours }}
                components={{
                  hours: <strong data-testid="reconcile-reported-hours" />,
                  done: <strong />,
                }}
              />
            </div>

            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span
                style={{
                  fontSize: 10,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--ink-4)",
                  fontFamily: "JetBrains Mono, monospace",
                }}
              >
                {t("reconcileHoursLabel")}
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={rawValue}
                onChange={(e) => setRawValue(e.target.value)}
                data-testid="reconcile-hours-input"
                disabled={isSubmitting}
                style={{
                  height: 30,
                  padding: "0 10px",
                  border: `1px solid ${isValid ? "var(--line)" : "var(--bad)"}`,
                  borderRadius: 4,
                  background: "var(--panel)",
                  color: "var(--ink)",
                  fontSize: 13,
                }}
              />
              {!isValid && (
                <span
                  data-testid="reconcile-hours-error"
                  style={{ fontSize: 11, color: "var(--bad)" }}
                >
                  {t("reconcileHoursError")}
                </span>
              )}
            </label>
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
              {tCommon("actions.escToClose")}
            </span>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              data-testid="reconcile-cancel"
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
              {tCommon("actions.cancel")}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!isValid || isSubmitting}
              data-testid="reconcile-confirm"
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
                opacity: !isValid || isSubmitting ? 0.55 : 1,
                cursor: !isValid || isSubmitting ? "not-allowed" : "pointer",
              }}
            >
              {isSubmitting ? t("reconcileConfirming") : t("reconcileConfirm")}
            </button>
          </div>
        </div>
      </div>
    </FocusTrap>
  );
}

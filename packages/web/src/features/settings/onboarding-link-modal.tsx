import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useEscapeKey } from "@/hooks/use-escape-key";
import { useBackdropClose } from "@/hooks/use-backdrop-close";
import { FocusTrap } from "focus-trap-react";

interface OnboardingLinkModalProps {
  open: boolean;
  onClose: () => void;
  url: string;        // kanon://<host>/onboard?token=<jwt>
  expiresAt: string;  // ISO 8601
}

function formatExpiry(expiresAt: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const msLeft = new Date(expiresAt).getTime() - Date.now();
  const hoursLeft = Math.max(0, Math.ceil(msLeft / (1000 * 60 * 60)));
  if (hoursLeft <= 1) return t("onboardingExpiresLessThanHour");
  if (hoursLeft < 24) return t("onboardingExpiresHours", { count: hoursLeft });
  const daysLeft = Math.ceil(hoursLeft / 24);
  return daysLeft === 1
    ? t("onboardingExpiresDay", { count: daysLeft })
    : t("onboardingExpiresDays", { count: daysLeft });
}

export function OnboardingLinkModal({
  open,
  onClose,
  url,
  expiresAt,
}: OnboardingLinkModalProps) {
  const { t } = useTranslation("settings");
  const { t: tCommon } = useTranslation("common");
  const [copied, setCopied] = useState(false);

  useEscapeKey(onClose, open);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [url]);

  const handleBackdropClick = useBackdropClose(onClose);

  if (!open) return null;

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
          alignItems: "center",
          justifyContent: "center",
          padding: "16px",
          background: "color-mix(in oklch, var(--bg) 70%, transparent)",
          backdropFilter: "blur(4px)",
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="onboarding-modal-title"
          data-testid="onboarding-link-modal"
          style={{
            position: "relative",
            width: "100%",
            maxWidth: 520,
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
              justifyContent: "space-between",
              padding: "12px 14px",
              borderBottom: "1px solid var(--line)",
              background: "var(--bg-2)",
            }}
          >
            <span
              id="onboarding-modal-title"
              className="mono"
              style={{
                fontSize: 10.5,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--ink-4)",
              }}
            >
              {t("onboardingTitle")}
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label={tCommon("actions.close")}
              data-testid="onboarding-close-btn"
              style={{ color: "var(--ink-4)", padding: 2, lineHeight: 1 }}
            >
              ✕
            </button>
          </div>

          {/* Body */}
          <div style={{ padding: "20px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
            {/* URL display */}
            <div>
              <p
                className="mono"
                style={{
                  fontSize: 9,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--ink-4)",
                  marginBottom: 6,
                }}
              >
                {t("onboardingShareHint")}
              </p>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  background: "var(--bg)",
                  border: "1px solid var(--line)",
                  borderRadius: 5,
                  padding: "8px 10px",
                }}
              >
                <code
                  data-testid="onboarding-url"
                  style={{
                    flex: 1,
                    fontSize: 11.5,
                    color: "var(--ink)",
                    wordBreak: "break-all",
                    fontFamily: "JetBrains Mono, monospace",
                  }}
                >
                  {url}
                </code>
                <button
                  type="button"
                  onClick={handleCopy}
                  data-testid="onboarding-copy-btn"
                  style={{
                    flexShrink: 0,
                    height: 26,
                    padding: "0 10px",
                    border: "1px solid var(--line)",
                    borderRadius: 4,
                    background: copied ? "var(--accent)" : "var(--panel)",
                    color: copied ? "var(--btn-ink)" : "var(--ink-2)",
                    fontSize: 11,
                    cursor: "pointer",
                    transition: "background 0.15s",
                  }}
                >
                  {copied ? t("onboardingCopied") : t("onboardingCopy")}
                </button>
              </div>
            </div>

            {/* Expiry + warning */}
            <div
              style={{
                background: "var(--bg)",
                border: "1px solid var(--line)",
                borderRadius: 5,
                padding: "10px 12px",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <p
                data-testid="onboarding-expiry"
                style={{ fontSize: 12, color: "var(--ink-3)", margin: 0 }}
              >
                {formatExpiry(expiresAt, t)} {t("onboardingValidNote")}
              </p>
              <p style={{ fontSize: 12, color: "var(--ink-3)", margin: 0 }}>
                {t("onboardingSingleUseNote")}
              </p>
            </div>
          </div>

          {/* Footer */}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              padding: "10px 14px",
              borderTop: "1px solid var(--line)",
              background: "var(--bg-2)",
            }}
          >
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
                cursor: "pointer",
              }}
            >
              {tCommon("actions.close")}
            </button>
          </div>
        </div>
      </div>
    </FocusTrap>
  );
}

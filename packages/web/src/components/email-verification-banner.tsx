import { useState } from "react";
import { useAuthStore } from "@/stores/auth-store";

export function EmailVerificationBanner() {
  const user = useAuthStore((s) => s.user);
  const [dismissed, setDismissed] = useState(false);
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  if (!user || user.emailVerified || dismissed) {
    return null;
  }

  async function handleResend() {
    setSending(true);
    try {
      await fetch("/api/auth/resend-verification", {
        method: "POST",
        credentials: "include",
      });
      // Always treat as success — no enumeration
      setSent(true);
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "10px 16px",
        background: "var(--warning-bg, #fefce8)",
        borderBottom: "1px solid var(--warning-border, #fde68a)",
        fontSize: 13,
        color: "var(--warning-ink, #78350f)",
        flexShrink: 0,
      }}
    >
      <span>
        {sent
          ? "Verification email sent — please check your inbox."
          : "Please verify your email address to unlock all features."}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        {!sent && (
          <button
            type="button"
            onClick={() => void handleResend()}
            disabled={sending}
            style={{
              padding: "3px 10px",
              borderRadius: 4,
              border: "1px solid var(--warning-border, #fde68a)",
              background: "transparent",
              color: "inherit",
              fontSize: 12,
              cursor: sending ? "not-allowed" : "pointer",
              fontWeight: 500,
            }}
          >
            {sending ? "Sending…" : "Resend"}
          </button>
        )}
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => setDismissed(true)}
          style={{
            padding: "2px 6px",
            borderRadius: 4,
            border: "none",
            background: "transparent",
            color: "inherit",
            fontSize: 14,
            cursor: "pointer",
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}

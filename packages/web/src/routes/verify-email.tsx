import { createRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { rootRoute } from "./__root";
import { useAuthStore } from "@/stores/auth-store";
import {
  AuthLayout,
  ErrorBox,
  H2,
  PrimaryBtn,
  Sub,
  SuccessBox,
} from "@/components/auth-layout";

// ─── Testable inner component ─────────────────────────────────────────────────

interface VerifyEmailViewProps {
  token: string | undefined;
  onSuccess: () => Promise<void>;
}

export function VerifyEmailView({ token, onSuccess }: VerifyEmailViewProps) {
  const { t } = useTranslation("auth");
  const navigate = useNavigate();
  const [status, setStatus] = useState<"pending" | "success" | "error">(
    token ? "pending" : "error",
  );
  const [errorMessage, setErrorMessage] = useState<string>(
    token ? "" : t("verify.error.noToken"),
  );

  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    async function verify() {
      try {
        const res = await fetch("/api/auth/verify-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ token }),
        });

        if (cancelled) return;

        if (res.ok) {
          setStatus("success");
          await onSuccess();
        } else {
          let message = t("verify.error.linkInvalidOrExpired");
          try {
            const body = (await res.json()) as Record<string, unknown>;
            if (typeof body.message === "string") message = body.message;
          } catch {
            // Not JSON — use default message
          }
          setErrorMessage(message);
          setStatus("error");
        }
      } catch {
        if (!cancelled) {
          setErrorMessage(t("verify.error.connectionFailed"));
          setStatus("error");
        }
      }
    }

    void verify();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `t` is stable across a fixed language
  }, [token, onSuccess]);

  const backToSignIn = (
    <div
      style={{
        display: "flex",
        justifyContent: "flex-end",
        fontSize: 12,
        color: "var(--ink-3)",
      }}
    >
      <button
        type="button"
        onClick={() => void navigate({ to: "/login" })}
        style={{ color: "var(--ink-3)" }}
      >
        {t("layout.backToSignIn")}
      </button>
    </div>
  );

  if (status === "pending") {
    return (
      <AuthLayout
        eyebrow={t("verify.pending.eyebrow")}
        title={t("verify.pending.title")}
        subtitle={t("verify.pending.subtitle")}
        footer={backToSignIn}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div>
            <H2>{t("verify.pending.heading")}</H2>
            <Sub>{t("verify.pending.body")}</Sub>
          </div>
        </div>
      </AuthLayout>
    );
  }

  if (status === "success") {
    return (
      <AuthLayout
        eyebrow={t("verify.success.eyebrow")}
        title={t("verify.success.title")}
        subtitle={t("verify.success.subtitle")}
        footer={backToSignIn}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div>
            <H2>{t("verify.success.heading")}</H2>
            <Sub>{t("verify.success.body")}</Sub>
          </div>
          <SuccessBox>{t("verify.success.box")}</SuccessBox>
          <PrimaryBtn type="button" onClick={() => void navigate({ to: "/workspaces" })}>
            {t("verify.success.continue")}
          </PrimaryBtn>
        </div>
      </AuthLayout>
    );
  }

  // error state
  return (
    <AuthLayout
      eyebrow={t("verify.error.eyebrow")}
      title={t("verify.error.title")}
      subtitle={t("verify.error.subtitle")}
      footer={backToSignIn}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        <div>
          <H2>{t("verify.error.heading")}</H2>
          <Sub>{t("verify.error.body")}</Sub>
        </div>
        <ErrorBox>{errorMessage}</ErrorBox>
        <PrimaryBtn type="button" onClick={() => void navigate({ to: "/login" })}>
          {t("verify.error.backToSignIn")}
        </PrimaryBtn>
      </div>
    </AuthLayout>
  );
}

// ─── Route ────────────────────────────────────────────────────────────────────

interface VerifyEmailSearch {
  token?: string;
}

export const verifyEmailRoute = createRoute({
  path: "/verify-email",
  getParentRoute: () => rootRoute,
  component: VerifyEmailPage,
  validateSearch: (search: Record<string, unknown>): VerifyEmailSearch => ({
    token: typeof search.token === "string" ? search.token : undefined,
  }),
});

function VerifyEmailPage() {
  const { token } = verifyEmailRoute.useSearch();
  const bootstrap = useAuthStore((s) => s.bootstrap);

  return <VerifyEmailView token={token} onSuccess={bootstrap} />;
}

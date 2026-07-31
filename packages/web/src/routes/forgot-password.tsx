import { createRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { rootRoute } from "./__root";
import {
  AuthLayout,
  ErrorBox,
  FormInput,
  H2,
  PrimaryBtn,
  Sub,
  SuccessBox,
} from "@/components/auth-layout";

export const forgotPasswordRoute = createRoute({
  path: "/forgot-password",
  getParentRoute: () => rootRoute,
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const { t } = useTranslation("auth");
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        let body: Record<string, unknown> = {};
        try {
          body = (await res.json()) as Record<string, unknown>;
        } catch {
          // Response may not be JSON
        }
        throw new Error(
          (body.message as string) ?? t("forgot.errors.unexpected"),
        );
      }

      setSubmitted(true);
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(t("forgot.errors.unexpected"));
      }
    } finally {
      setLoading(false);
    }
  }

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

  if (submitted) {
    return (
      <AuthLayout
        eyebrow={t("forgot.submitted.eyebrow")}
        title={t("forgot.submitted.title")}
        subtitle={t("forgot.submitted.subtitle")}
        footer={backToSignIn}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div>
            <H2>{t("forgot.submitted.heading")}</H2>
            <Sub>
              {t("forgot.submitted.bodyBefore")} <span className="mono">{email}</span>
              {t("forgot.submitted.bodyAfter")}
            </Sub>
          </div>
          <SuccessBox>{t("forgot.submitted.success")}</SuccessBox>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      eyebrow={t("forgot.eyebrow")}
      title={t("forgot.title")}
      subtitle={t("forgot.subtitle")}
      footer={backToSignIn}
    >
      <form
        onSubmit={(e) => { void handleSubmit(e); }}
        style={{ display: "flex", flexDirection: "column", gap: 22 }}
      >
        <div>
          <H2>{t("forgot.form.heading")}</H2>
          <Sub>{t("forgot.form.subheading")}</Sub>
        </div>
        <FormInput
          id="email"
          fieldLabel={t("forgot.fields.workEmail")}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("forgot.fields.workEmailPlaceholder")}
          required
          autoFocus
        />
        {error && <ErrorBox>{error}</ErrorBox>}
        <PrimaryBtn disabled={loading}>
          {loading ? t("forgot.submit.sending") : t("forgot.submit.sendResetLink")}
        </PrimaryBtn>
      </form>
    </AuthLayout>
  );
}

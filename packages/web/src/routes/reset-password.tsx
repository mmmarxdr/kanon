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
import { PasswordRequirements } from "@/components/password-requirements";
import { evaluatePassword, isPasswordValid } from "@/lib/password-policy";

interface ResetPasswordSearch {
  token?: string;
}

export const resetPasswordRoute = createRoute({
  path: "/reset-password",
  getParentRoute: () => rootRoute,
  component: ResetPasswordPage,
  validateSearch: (search: Record<string, unknown>): ResetPasswordSearch => ({
    token: typeof search.token === "string" ? search.token : undefined,
  }),
});

function ResetPasswordPage() {
  const { t } = useTranslation("auth");
  const navigate = useNavigate();
  const { token } = resetPasswordRoute.useSearch();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwTouched, setPwTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  // Derived at render — no redundant state
  const requirements = evaluatePassword(password, confirmPassword);
  const valid = isPasswordValid(requirements);

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

  if (!token) {
    return (
      <AuthLayout
        eyebrow={t("reset.noToken.eyebrow")}
        title={t("reset.noToken.title")}
        subtitle={t("reset.noToken.subtitle")}
        footer={backToSignIn}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div>
            <H2>{t("reset.noToken.heading")}</H2>
            <Sub>
              {t("reset.noToken.body")}
            </Sub>
          </div>
          <PrimaryBtn
            type="button"
            onClick={() => void navigate({ to: "/forgot-password" })}
          >
            {t("reset.noToken.requestNew")}
          </PrimaryBtn>
        </div>
      </AuthLayout>
    );
  }

  if (success) {
    return (
      <AuthLayout
        eyebrow={t("reset.success.eyebrow")}
        title={t("reset.success.title")}
        subtitle={t("reset.success.subtitle")}
        footer={backToSignIn}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div>
            <H2>{t("reset.success.heading")}</H2>
            <Sub>{t("reset.success.body")}</Sub>
          </div>
          <SuccessBox>{t("reset.success.box")}</SuccessBox>
          <PrimaryBtn type="button" onClick={() => void navigate({ to: "/login" })}>
            {t("reset.success.signIn")}
          </PrimaryBtn>
        </div>
      </AuthLayout>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!valid) {
      setError(t("reset.errors.passwordRequirements"));
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token, newPassword: password }),
      });

      if (!res.ok) {
        let body: Record<string, unknown> = {};
        try {
          body = (await res.json()) as Record<string, unknown>;
        } catch {
          // Response may not be JSON
        }
        throw new Error(
          (body.message as string) ?? t("reset.errors.unexpected"),
        );
      }

      setSuccess(true);
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(t("reset.errors.unexpected"));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      eyebrow={t("reset.form.eyebrow")}
      title={t("reset.form.title")}
      subtitle={t("reset.form.subtitle")}
      footer={backToSignIn}
    >
      <form
        onSubmit={(e) => { void handleSubmit(e); }}
        data-testid="reset-password-form"
        style={{ display: "flex", flexDirection: "column", gap: 22 }}
      >
        <div>
          <H2>{t("reset.form.heading")}</H2>
          <Sub>{t("reset.form.subheading")}</Sub>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <FormInput
            id="password"
            fieldLabel={t("reset.fields.newPassword")}
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (!pwTouched) setPwTouched(true);
            }}
            placeholder={t("reset.fields.newPasswordPlaceholder")}
            required
            minLength={12}
            maxLength={128}
            aria-describedby="password-requirements"
          />
          <FormInput
            id="confirmPassword"
            fieldLabel={t("reset.fields.confirmPassword")}
            type="password"
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              if (!pwTouched) setPwTouched(true);
            }}
            placeholder={t("reset.fields.confirmPasswordPlaceholder")}
            required
            minLength={12}
            maxLength={128}
          />
          <PasswordRequirements requirements={pwTouched ? requirements : []} />
        </div>
        {error && <ErrorBox>{error}</ErrorBox>}
        <PrimaryBtn disabled={loading || !valid}>
          {loading ? t("reset.submit.resetting") : t("reset.submit.resetPassword")}
        </PrimaryBtn>
      </form>
    </AuthLayout>
  );
}

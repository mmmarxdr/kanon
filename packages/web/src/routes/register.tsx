import { createRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { rootRoute } from "./__root";
import { useAuthStore } from "@/stores/auth-store";
import { fetchApi, ApiError } from "@/lib/api-client";
import type { AuthUser } from "@/stores/auth-store";
import {
  AuthLayout,
  ErrorBox,
  FormInput,
  H2,
  PrimaryBtn,
  Sub,
} from "@/components/auth-layout";
import { PasswordRequirements } from "@/components/password-requirements";
import { evaluatePassword, isPasswordValid } from "@/lib/password-policy";

interface RegisterSearch {
  invite?: string;
}

export const registerRoute = createRoute({
  path: "/register",
  getParentRoute: () => rootRoute,
  component: RegisterPage,
  validateSearch: (search: Record<string, unknown>): RegisterSearch => ({
    invite: typeof search.invite === "string" ? search.invite : undefined,
  }),
});

// ─── Presentational form — extracted for testability ─────────────────────────

interface RegisterFormProps {
  invite?: string;
  onNavigate: ReturnType<typeof useNavigate>;
}

export function RegisterForm({ invite, onNavigate }: RegisterFormProps) {
  const { t } = useTranslation("auth");
  const { setUser } = useAuthStore();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwTouched, setPwTouched] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Derived at render — no redundant state
  const requirements = evaluatePassword(password, confirmPassword);
  const valid = isPasswordValid(requirements);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!agreedToTerms) return;
    if (!valid) {
      setError(t("register.errors.passwordRequirements"));
      return;
    }
    setError(null);
    setLoading(true);

    try {
      if (invite) {
        // 1-hop flow: register WITH invite token.
        // Server creates the User, accepts the invite, and issues a session
        // (auth cookies + tokens) in a single request (R-NUI-autologin).
        await fetchApi("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({
            email,
            password,
            displayName: displayName || undefined,
            invite,
          }),
        });

        // Bootstrap the auth store from the session cookie that was just set.
        // Mirror login.tsx: GET /me → setUser — the session cookie is live.
        const user = await fetchApi<AuthUser>("/api/auth/me");
        setUser(user);

        void onNavigate({ to: "/workspaces" });
      } else {
        // No invite: original behavior — register, then redirect to /login.
        await fetchApi("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({
            email,
            password,
            displayName: displayName || undefined,
          }),
        });

        void onNavigate({ to: "/login", search: {} });
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(t("register.errors.unexpected"));
      }
    } finally {
      setLoading(false);
    }
  }

  // Invite-aware copy: when an invite is present, frame as joining.
  const eyebrow = invite ? t("register.invite.eyebrow") : t("register.default.eyebrow");
  const title = invite ? t("register.invite.title") : t("register.default.title");
  const subtitle = invite
    ? t("register.invite.subtitle")
    : t("register.default.subtitle");
  const submitLabel = invite ? t("register.invite.submit") : t("register.default.submit");

  return (
    <AuthLayout
      eyebrow={eyebrow}
      title={title}
      subtitle={subtitle}
      footer={
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            fontSize: 12,
            color: "var(--ink-3)",
            gap: 8,
          }}
        >
          {t("register.footer.alreadyOnKanon")}{" "}
          <button
            type="button"
            onClick={() =>
              void onNavigate({
                to: "/login",
                search: invite ? { invite } : {},
              })
            }
            style={{ color: "var(--accent-ink)", fontWeight: 500 }}
          >
            {t("register.footer.signIn")}
          </button>
        </div>
      }
    >
      <form
        onSubmit={(e) => { void handleSubmit(e); }}
        data-testid="register-form"
        style={{ display: "flex", flexDirection: "column", gap: 22 }}
      >
        <div>
          <H2>{invite ? t("register.invite.heading") : t("register.default.heading")}</H2>
          <Sub>{subtitle}</Sub>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <FormInput
            id="displayName"
            fieldLabel={t("register.fields.fullName")}
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={t("register.fields.fullNamePlaceholder")}
            maxLength={100}
          />
          <FormInput
            id="email"
            fieldLabel={t("register.fields.workEmail")}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("register.fields.workEmailPlaceholder")}
            required
          />
          <FormInput
            id="password"
            fieldLabel={t("register.fields.password")}
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (!pwTouched) setPwTouched(true);
            }}
            placeholder={t("register.fields.passwordPlaceholder")}
            required
            minLength={8}
            maxLength={128}
            aria-describedby="password-requirements"
          />
          <FormInput
            id="confirmPassword"
            fieldLabel={t("register.fields.confirmPassword")}
            type="password"
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              if (!pwTouched) setPwTouched(true);
            }}
            placeholder={t("register.fields.confirmPasswordPlaceholder")}
            required
            minLength={8}
            maxLength={128}
          />
          <PasswordRequirements requirements={pwTouched ? requirements : []} />
        </div>

        {/* Terms of Service — required gate, client-side only */}
        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            fontSize: 11.5,
            color: "var(--ink-3)",
            lineHeight: 1.5,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            data-testid="tos-checkbox"
            checked={agreedToTerms}
            onChange={(e) => setAgreedToTerms(e.target.checked)}
            style={{ marginTop: 2, accentColor: "var(--accent)" }}
          />
          <span>
            {t("register.tos.prefix")}{" "}
            {/* TODO: link to /terms when that page exists */}
            <button
              type="button"
              tabIndex={-1}
              aria-disabled
              style={{ color: "var(--accent-ink)", cursor: "default" }}
            >
              {t("register.tos.termsOfService")}
            </button>{" "}
            {t("register.tos.conjunction")}{" "}
            {/* TODO: link to /privacy when that page exists */}
            <button
              type="button"
              tabIndex={-1}
              aria-disabled
              style={{ color: "var(--accent-ink)", cursor: "default" }}
            >
              {t("register.tos.privacyPolicy")}
            </button>
            {t("register.tos.suffix")}
          </span>
        </label>

        {error && (
          <div data-testid="register-error">
            <ErrorBox>{error}</ErrorBox>
          </div>
        )}

        <PrimaryBtn disabled={loading || !agreedToTerms || !valid}>
          {loading ? t("register.submit.creating") : submitLabel}
        </PrimaryBtn>
      </form>
    </AuthLayout>
  );
}

// ─── Route wrapper — reads router state and delegates to RegisterForm ─────────

function RegisterPage() {
  const navigate = useNavigate();
  const { invite } = registerRoute.useSearch();

  return <RegisterForm invite={invite} onNavigate={navigate} />;
}

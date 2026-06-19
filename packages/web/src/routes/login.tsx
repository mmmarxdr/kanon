import { createRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
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
  GhostBtn,
  MonoDivider,
  ComingSoonTooltip,
  SuccessBox,
} from "@/components/auth-layout";

interface LoginSearch {
  invite?: string;
}

export const loginRoute = createRoute({
  path: "/login",
  getParentRoute: () => rootRoute,
  component: LoginPage,
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    invite: typeof search.invite === "string" ? search.invite : undefined,
  }),
});

// ─── Presentational form — extracted for testability ─────────────────────────

interface LoginFormProps {
  invite?: string;
  onNavigate: ReturnType<typeof useNavigate>;
}

export function LoginForm({ invite, onNavigate }: LoginFormProps) {
  const { setUser } = useAuthStore();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Magic-link state
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [magicLinkLoading, setMagicLinkLoading] = useState(false);
  const [magicLinkError, setMagicLinkError] = useState<string | null>(null);

  async function handleMagicLink() {
    if (!email.trim()) {
      setMagicLinkError("Enter your email address above first.");
      return;
    }
    setMagicLinkError(null);
    setMagicLinkLoading(true);
    try {
      const res = await fetch("/api/auth/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        throw new Error("Request failed");
      }
      setMagicLinkSent(true);
    } catch {
      setMagicLinkError("Could not send sign-in link. Please try again.");
    } finally {
      setMagicLinkLoading(false);
    }
  }

  // ── Magic-link sent state ─────────────────────────────────────────────────
  if (magicLinkSent) {
    return (
      <AuthLayout
        eyebrow="Check your inbox"
        title="Sign-in link sent."
        subtitle="We emailed you a magic link. Click it to sign in instantly."
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", fontSize: 12, color: "var(--ink-3)" }}>
            <button
              type="button"
              onClick={() => { setMagicLinkSent(false); setMagicLinkError(null); }}
              style={{ color: "var(--ink-3)" }}
            >
              ← Try a different email
            </button>
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div>
            <H2>Check your email</H2>
            <Sub>We sent a sign-in link to <strong>{email}</strong>. The link is valid for 15 minutes.</Sub>
          </div>
          <SuccessBox>Sign-in link sent — check your inbox (and spam folder).</SuccessBox>
          <PrimaryBtn
            type="button"
            onClick={() => {
              setMagicLinkSent(false);
              setMagicLinkLoading(false);
              setMagicLinkError(null);
            }}
          >
            Resend →
          </PrimaryBtn>
          <button
            type="button"
            onClick={() => void onNavigate({ to: "/login" })}
            style={{ fontSize: 12, color: "var(--ink-3)", textAlign: "center" }}
          >
            Back to sign in with password
          </button>
        </div>
      </AuthLayout>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const loginRes = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });

      if (!loginRes.ok) {
        let body: Record<string, unknown> = {};
        try {
          body = (await loginRes.json()) as Record<string, unknown>;
        } catch {
          // Response may not be JSON
        }
        throw new ApiError(
          loginRes.status,
          (body.code as string) ?? "UNKNOWN_ERROR",
          (body.message as string) ?? loginRes.statusText,
        );
      }

      const user = await fetchApi<AuthUser>("/api/auth/me");
      setUser(user);

      if (invite) {
        // Surface accept failures inline — do NOT silently swallow them.
        // Spec R-NUI-surface: any 4xx (expired, exhausted, email-mismatch) must
        // be shown; navigating to /workspaces without membership is prohibited.
        // Design note: original design said navigate('/invite/:token') on error,
        // but email-mismatch (403) leaves the invite "valid" so that page shows
        // no error reason. Inline error on login covers all failure modes.
        await fetchApi(`/api/invites/${invite}/accept`, {
          method: "POST",
          body: JSON.stringify({}),
        });
      }

      void onNavigate({ to: "/workspaces" });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("An unexpected error occurred");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      eyebrow="Welcome back"
      title="Make work concrete."
      subtitle="The instrument-grade tracker for teams that ship faster than they plan."
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
          New to Kanon?{" "}
          <button
            type="button"
            onClick={() =>
              void onNavigate({
                to: "/register",
                search: invite ? { invite } : {},
              })
            }
            style={{ color: "var(--accent-ink)", fontWeight: 500 }}
          >
            Create workspace →
          </button>
        </div>
      }
    >
      <form
        onSubmit={(e) => { void handleSubmit(e); }}
        data-testid="login-form"
        style={{ display: "flex", flexDirection: "column", gap: 22 }}
      >
        <div>
          <H2>Sign in to your workspace</H2>
          <Sub>Use your work email or single sign-on.</Sub>
        </div>

        {/* SSO buttons — coming soon, rendered disabled for visual hierarchy */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <ComingSoonTooltip>
            <GhostBtn
              disabled
              data-testid="sso-google-btn"
              icon={<GoogleIcon />}
            >
              Continue with Google
            </GhostBtn>
          </ComingSoonTooltip>
          <ComingSoonTooltip>
            <GhostBtn
              disabled
              data-testid="sso-saml-btn"
              icon={<KeyIcon />}
            >
              Continue with SAML SSO
            </GhostBtn>
          </ComingSoonTooltip>
        </div>

        <MonoDivider label="or with email" />

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <FormInput
            id="email"
            fieldLabel="Work email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            required
            autoFocus
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
              }}
            >
              <label
                htmlFor="password"
                style={{
                  fontSize: 11,
                  color: "var(--ink-3)",
                  fontWeight: 500,
                }}
              >
                Password
              </label>
              <button
                type="button"
                onClick={() => void onNavigate({ to: "/forgot-password" })}
                style={{
                  fontSize: 11,
                  color: "var(--accent-ink)",
                }}
              >
                Forgot?
              </button>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                height: 36,
                border: "1px solid var(--line-2)",
                borderRadius: 5,
                background: "var(--panel)",
                padding: "0 10px",
              }}
            >
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                style={{
                  flex: 1,
                  height: "100%",
                  border: 0,
                  outline: 0,
                  background: "transparent",
                  color: "var(--ink)",
                  fontSize: 13,
                }}
              />
            </div>
          </div>
        </div>

        {error && (
          <div data-testid="login-error">
            <ErrorBox>{error}</ErrorBox>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <PrimaryBtn disabled={loading}>
            {loading ? "Signing in…" : "Sign in →"}
          </PrimaryBtn>
          {magicLinkError && (
            <div data-testid="magic-link-error" style={{ fontSize: 12, color: "var(--bad)" }}>
              {magicLinkError}
            </div>
          )}
          <button
            type="button"
            disabled={magicLinkLoading}
            data-testid="magic-link-btn"
            onClick={() => { void handleMagicLink(); }}
            style={{
              height: 32,
              fontSize: 12,
              color: "var(--accent-ink)",
              cursor: magicLinkLoading ? "wait" : "pointer",
              width: "100%",
              opacity: magicLinkLoading ? 0.6 : 1,
              textDecoration: "underline",
              background: "none",
              border: "none",
            }}
          >
            {magicLinkLoading ? "Sending…" : "Email me a magic link instead"}
          </button>
        </div>
      </form>
    </AuthLayout>
  );
}

// ─── Route wrapper — reads router state and delegates to LoginForm ────────────

function LoginPage() {
  const navigate = useNavigate();
  const { invite } = loginRoute.useSearch();

  return <LoginForm invite={invite} onNavigate={navigate} />;
}

// ─── Inline SVG icons (no extra dep) ─────────────────────────────────────────

function GoogleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M21.6 12.227c0-.7-.06-1.37-.18-2.018H12v3.818h5.39c-.232 1.25-.937 2.31-1.997 3.018v2.51h3.234C20.523 17.79 21.6 15.227 21.6 12.227z" fill="var(--ink-2)"/>
      <path d="M12 22c2.7 0 4.964-.895 6.626-2.426l-3.235-2.51c-.895.6-2.04.954-3.39.954-2.604 0-4.81-1.76-5.596-4.122H3.064v2.59C4.717 19.778 8.09 22 12 22z" fill="var(--ink-3)"/>
      <path d="M6.404 13.896A5.99 5.99 0 016.09 12c0-.66.114-1.3.314-1.896V7.514H3.064A9.996 9.996 0 002 12c0 1.614.387 3.142 1.064 4.486l3.34-2.59z" fill="var(--ink-3)"/>
      <path d="M12 5.978c1.47 0 2.786.504 3.823 1.495l2.867-2.867C16.96 3.018 14.696 2 12 2 8.09 2 4.717 4.222 3.064 7.514l3.34 2.59C7.19 7.737 9.397 5.977 12 5.977z" fill="var(--ink-2)"/>
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="6" cy="10" r="3"/>
      <path d="M8.1 8L14 2.1M11 5L13 7"/>
    </svg>
  );
}

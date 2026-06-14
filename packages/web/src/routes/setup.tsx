/**
 * /setup — Public one-time super-admin claim page (KAN-49).
 *
 * On mount: checks GET /api/instance/setup/status.
 * If already claimed → navigates to /login (instance already has an owner).
 * Otherwise renders a claim form: token + email + password.
 *
 * Error taxonomy mapping (inline field errors):
 *  INVALID_TOKEN / TOKEN_EXPIRED / TOKEN_USED → token-field error
 *  EMAIL_EXISTS (409)                          → email-field error
 *  VALIDATION_ERROR (400, Zod weak password)   → password-field error
 *
 * On success: GET /me → setUser → navigate to /admin/instance.
 *
 * Pattern: mirrors login.tsx (raw fetch + manual ApiError) and register.tsx
 * (extracted presentational form component for testability).
 */
import { createRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { rootRoute } from "./__root";
import { useAuthStore } from "@/stores/auth-store";
import { ApiError } from "@/lib/api-client";
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

// ─── Field-level error state ──────────────────────────────────────────────────

interface FieldErrors {
  token?: string;
  email?: string;
  password?: string;
  form?: string;
}

// ─── Route definition ─────────────────────────────────────────────────────────

export const setupRoute = createRoute({
  path: "/setup",
  getParentRoute: () => rootRoute,
  component: SetupPage,
});

// ─── Presentational form — extracted for testability ─────────────────────────

interface SetupFormProps {
  onNavigate: ReturnType<typeof useNavigate>;
}

export function SetupForm({ onNavigate }: SetupFormProps) {
  const { setUser } = useAuthStore();

  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwTouched, setPwTouched] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [loading, setLoading] = useState(false);
  const [statusChecked, setStatusChecked] = useState(false);

  // Derived at render — no redundant state
  const requirements = evaluatePassword(password, confirmPassword);
  const valid = isPasswordValid(requirements);

  // On mount: check if instance is already claimed. If so, redirect to /login.
  // Pattern: in-component useEffect fetch + navigate (mirrors invite.tsx).
  useEffect(() => {
    async function checkStatus() {
      try {
        const res = await fetch("/api/instance/setup/status", {
          credentials: "include",
        });
        if (res.ok) {
          const body = (await res.json()) as { claimed: boolean };
          if (body.claimed) {
            void onNavigate({ to: "/login" });
            return;
          }
        }
      } catch {
        // Network error — allow form to render, claim will fail naturally
      }
      setStatusChecked(true);
    }

    void checkStatus();
  }, [onNavigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) {
      setErrors({ password: "Please ensure your password meets all requirements." });
      return;
    }
    setErrors({});
    setLoading(true);

    try {
      // POST /api/instance/setup/claim — raw fetch mirrors login.tsx pattern
      const claimRes = await fetch("/api/instance/setup/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token, email, password }),
      });

      if (!claimRes.ok) {
        let body: Record<string, unknown> = {};
        try {
          body = (await claimRes.json()) as Record<string, unknown>;
        } catch {
          // Response may not be JSON
        }

        const code = (body.code as string) ?? (body.error as string) ?? "UNKNOWN_ERROR";
        const message = (body.message as string) ?? claimRes.statusText;

        // Map error taxonomy to inline field messages
        if (
          code === "INVALID_TOKEN" ||
          code === "TOKEN_EXPIRED" ||
          code === "TOKEN_USED"
        ) {
          setErrors({ token: message });
        } else if (claimRes.status === 409 || code === "EMAIL_EXISTS") {
          setErrors({
            email: "An account with this email already exists — use a new dedicated admin email",
          });
        } else if (code === "VALIDATION_ERROR") {
          setErrors({
            password: "Password does not meet the requirements — please check the checklist below.",
          });
        } else {
          setErrors({ form: message });
        }
        return;
      }

      // Claim succeeded — fetch /me to populate auth store (mirrors register.tsx invite branch)
      const meRes = await fetch("/api/auth/me", { credentials: "include" });
      if (meRes.ok) {
        const user = (await meRes.json()) as AuthUser;
        setUser(user);
      }

      void onNavigate({ to: "/admin/instance" });
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors({ form: err.message });
      } else {
        setErrors({ form: "An unexpected error occurred" });
      }
    } finally {
      setLoading(false);
    }
  }

  // Show spinner until status check completes (avoids form flash on claimed instance)
  if (!statusChecked) {
    return (
      <div
        style={{
          display: "flex",
          height: "100vh",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg)",
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            border: "2px solid var(--accent)",
            borderTopColor: "transparent",
            animation: "spin 0.8s linear infinite",
          }}
        />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <AuthLayout
      eyebrow="First boot"
      title="Claim your instance."
      subtitle="Set up the super-admin account. This can only be done once."
    >
      <form
        onSubmit={(e) => { void handleSubmit(e); }}
        data-testid="setup-form"
        style={{ display: "flex", flexDirection: "column", gap: 22 }}
      >
        <div>
          <H2>Claim super-admin</H2>
          <Sub>
            Enter the token from the application logs, choose a dedicated admin
            email, and set a strong password.
          </Sub>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Token field */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <FormInput
              id="setup-token"
              fieldLabel="Setup token"
              type="text"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste the token from server logs"
              required
              autoFocus
            />
            {errors.token && (
              <div
                data-testid="setup-token-error"
                style={{ fontSize: 12, color: "var(--bad)" }}
              >
                {errors.token}
              </div>
            )}
          </div>

          {/* Email field */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <FormInput
              id="setup-email"
              fieldLabel="Admin email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@your-company.com"
              required
            />
            {errors.email && (
              <div
                data-testid="setup-email-error"
                style={{ fontSize: 12, color: "var(--bad)" }}
              >
                {errors.email}
              </div>
            )}
          </div>

          {/* Password field */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <FormInput
              id="setup-password"
              fieldLabel="Password"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (!pwTouched) setPwTouched(true);
              }}
              placeholder="At least 12 characters"
              required
              minLength={12}
              maxLength={128}
              aria-describedby="password-requirements"
            />
            {errors.password && (
              <div
                data-testid="setup-password-error"
                style={{ fontSize: 12, color: "var(--bad)" }}
              >
                {errors.password}
              </div>
            )}
          </div>

          {/* Confirm password field */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <FormInput
              id="setup-confirm-password"
              fieldLabel="Confirm password"
              type="password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                if (!pwTouched) setPwTouched(true);
              }}
              placeholder="Repeat your password"
              required
              minLength={12}
              maxLength={128}
            />
          </div>

          <PasswordRequirements requirements={pwTouched ? requirements : []} />
        </div>

        {errors.form && (
          <div data-testid="setup-form-error">
            <ErrorBox>{errors.form}</ErrorBox>
          </div>
        )}

        <PrimaryBtn disabled={loading || !valid}>
          {loading ? "Claiming…" : "Claim instance →"}
        </PrimaryBtn>
      </form>
    </AuthLayout>
  );
}

// ─── Route wrapper ────────────────────────────────────────────────────────────

function SetupPage() {
  const navigate = useNavigate();
  return <SetupForm onNavigate={navigate} />;
}

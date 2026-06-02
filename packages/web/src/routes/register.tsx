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
} from "@/components/auth-layout";

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
  const { setUser } = useAuthStore();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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
        setError("An unexpected error occurred");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      eyebrow="New here"
      title="Set up your workspace."
      subtitle="Two minutes to a working tracker. Invite your team after."
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
          Already on Kanon?{" "}
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
            Sign in →
          </button>
        </div>
      }
    >
      <form
        onSubmit={handleSubmit}
        data-testid="register-form"
        style={{ display: "flex", flexDirection: "column", gap: 22 }}
      >
        <div>
          <H2>Create your account</H2>
          <Sub>Free for teams under 10. No credit card.</Sub>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <FormInput
            id="displayName"
            fieldLabel="Full name"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Your name"
            maxLength={100}
          />
          <FormInput
            id="email"
            fieldLabel="Work email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            required
          />
          <FormInput
            id="password"
            fieldLabel="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            required
            minLength={8}
            maxLength={128}
          />
        </div>

        {error && (
          <div data-testid="register-error">
            <ErrorBox>{error}</ErrorBox>
          </div>
        )}

        <PrimaryBtn disabled={loading}>
          {loading ? "Creating account…" : "Create account →"}
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

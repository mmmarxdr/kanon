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

function LoginPage() {
  const navigate = useNavigate();
  const { setUser } = useAuthStore();
  const { invite } = loginRoute.useSearch();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
        try {
          await fetchApi(`/api/invites/${invite}/accept`, {
            method: "POST",
            body: JSON.stringify({}),
          });
        } catch {
          // Don't block the auth flow
        }
      }

      void navigate({ to: "/workspaces" });
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
              void navigate({
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
        onSubmit={handleSubmit}
        data-testid="login-form"
        style={{ display: "flex", flexDirection: "column", gap: 22 }}
      >
        <div>
          <H2>Sign in to your workspace</H2>
          <Sub>Use your work email to access your team.</Sub>
        </div>

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
                onClick={() => void navigate({ to: "/forgot-password" })}
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

        {error && <div data-testid="login-error"><ErrorBox>{error}</ErrorBox></div>}

        <PrimaryBtn disabled={loading}>
          {loading ? "Signing in…" : "Sign in →"}
        </PrimaryBtn>
      </form>
    </AuthLayout>
  );
}

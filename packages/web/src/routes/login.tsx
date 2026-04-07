import { createRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { rootRoute } from "./__root";
import { useAuthStore } from "@/stores/auth-store";
import { fetchApi, ApiError } from "@/lib/api-client";
import type { AuthUser } from "@/stores/auth-store";

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
      // Login — use direct fetch (not fetchApi) to avoid the 401 auto-refresh
      // interceptor which would redirect back to /login before we can show an error.
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

      // Fetch user info from /me (using the cookies just set)
      const user = await fetchApi<AuthUser>("/api/auth/me");
      setUser(user);

      // If there's a pending invite token, accept it after login
      if (invite) {
        try {
          await fetchApi(`/api/invites/${invite}/accept`, {
            method: "POST",
            body: JSON.stringify({}),
          });
        } catch {
          // Don't block the auth flow — the user is logged in regardless.
          // They can retry accepting the invite from the invite link.
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
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-sm animate-fade-in">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-foreground">
            Sign in to <span className="text-primary">Kanon</span>
          </h1>
        </div>

        <form onSubmit={handleSubmit} data-testid="login-form" className="space-y-4">
          <div className="space-y-2">
            <label
              htmlFor="email"
              className="text-sm font-medium text-card-foreground"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              className="w-full rounded-md border border-input bg-[#E8E8E8] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 transition-all duration-150 ease-out"
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="password"
              className="text-sm font-medium text-card-foreground"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              required
              className="w-full rounded-md border border-input bg-[#E8E8E8] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 transition-all duration-150 ease-out"
            />
          </div>

          <div className="flex justify-end">
            <a
              href="/forgot-password"
              onClick={(e) => {
                e.preventDefault();
                void navigate({ to: "/forgot-password" });
              }}
              className="text-xs text-primary underline-offset-4 hover:underline"
            >
              Forgot password?
            </a>
          </div>

          {error && (
            <div data-testid="login-error" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200 ease-out"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          Don't have an account?{" "}
          <a
            href="/register"
            onClick={(e) => {
              e.preventDefault();
              void navigate({
                to: "/register",
                search: invite ? { invite } : {},
              });
            }}
            className="text-primary underline-offset-4 hover:underline"
          >
            Register
          </a>
        </p>
      </div>
    </div>
  );
}

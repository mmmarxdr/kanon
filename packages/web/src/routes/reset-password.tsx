import { createRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { rootRoute } from "./__root";

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
  const navigate = useNavigate();
  const { token } = resetPasswordRoute.useSearch();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-sm animate-fade-in">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold text-foreground">
              Invalid reset link
            </h1>
          </div>

          <p className="text-center text-sm text-muted-foreground">
            This password reset link is invalid or has expired. Please request a
            new one.
          </p>

          <p className="mt-4 text-center text-sm text-muted-foreground">
            <a
              href="/forgot-password"
              onClick={(e) => {
                e.preventDefault();
                void navigate({ to: "/forgot-password" });
              }}
              className="text-primary underline-offset-4 hover:underline"
            >
              Request a new reset link
            </a>
          </p>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-sm animate-fade-in">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold text-foreground">
              Password reset successful
            </h1>
          </div>

          <p className="text-center text-sm text-muted-foreground">
            Your password has been updated. You can now sign in with your new
            password.
          </p>

          <p className="mt-4 text-center text-sm text-muted-foreground">
            <a
              href="/login"
              onClick={(e) => {
                e.preventDefault();
                void navigate({ to: "/login" });
              }}
              className="text-primary underline-offset-4 hover:underline"
            >
              Sign in
            </a>
          </p>
        </div>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
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
          (body.message as string) ?? "An unexpected error occurred",
        );
      }

      setSuccess(true);
    } catch (err) {
      if (err instanceof Error) {
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
            Set new password
          </h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label
              htmlFor="password"
              className="text-sm font-medium text-card-foreground"
            >
              New Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              required
              minLength={8}
              maxLength={128}
              className="w-full rounded-md border border-input bg-[#E8E8E8] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 transition-all duration-150 ease-out"
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="confirmPassword"
              className="text-sm font-medium text-card-foreground"
            >
              Confirm Password
            </label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat your password"
              required
              minLength={8}
              maxLength={128}
              className="w-full rounded-md border border-input bg-[#E8E8E8] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 transition-all duration-150 ease-out"
            />
          </div>

          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200 ease-out"
          >
            {loading ? "Resetting..." : "Reset password"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          <a
            href="/login"
            onClick={(e) => {
              e.preventDefault();
              void navigate({ to: "/login" });
            }}
            className="text-primary underline-offset-4 hover:underline"
          >
            Back to sign in
          </a>
        </p>
      </div>
    </div>
  );
}

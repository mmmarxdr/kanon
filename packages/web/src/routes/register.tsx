import { createRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { rootRoute } from "./__root";
import { fetchApi, ApiError } from "@/lib/api-client";

export const registerRoute = createRoute({
  path: "/register",
  getParentRoute: () => rootRoute,
  component: RegisterPage,
});

function RegisterPage() {
  const navigate = useNavigate();

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await fetchApi("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ username, email, password, workspaceId }),
      });

      // Registration successful — redirect to login
      void navigate({ to: "/login" });
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
            Create your <span className="text-primary">Kanon</span> account
          </h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label
              htmlFor="workspaceId"
              className="text-sm font-medium text-card-foreground"
            >
              Workspace ID
            </label>
            <input
              id="workspaceId"
              type="text"
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              required
              className="w-full rounded-md border border-input bg-[#E8E8E8] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 transition-all duration-150 ease-out"
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="username"
              className="text-sm font-medium text-card-foreground"
            >
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="johndoe"
              required
              minLength={2}
              maxLength={50}
              className="w-full rounded-md border border-input bg-[#E8E8E8] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 transition-all duration-150 ease-out"
            />
          </div>

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
              placeholder="At least 8 characters"
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
            {loading ? "Creating account..." : "Create account"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
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

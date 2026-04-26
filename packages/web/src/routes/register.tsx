import { createRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { rootRoute } from "./__root";
import { fetchApi, ApiError } from "@/lib/api-client";
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

function RegisterPage() {
  const navigate = useNavigate();
  const { invite } = registerRoute.useSearch();

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
      await fetchApi("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          email,
          password,
          displayName: displayName || undefined,
        }),
      });

      void navigate({
        to: "/login",
        search: invite ? { invite } : {},
      });
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
              void navigate({
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

        {error && <ErrorBox>{error}</ErrorBox>}

        <PrimaryBtn disabled={loading}>
          {loading ? "Creating account…" : "Create account →"}
        </PrimaryBtn>
      </form>
    </AuthLayout>
  );
}

import { createRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
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

export const forgotPasswordRoute = createRoute({
  path: "/forgot-password",
  getParentRoute: () => rootRoute,
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email }),
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

      setSubmitted(true);
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
        ← Back to sign in
      </button>
    </div>
  );

  if (submitted) {
    return (
      <AuthLayout
        eyebrow="Inbox"
        title="Check your email."
        subtitle="If an account exists, we've sent reset instructions. The link expires in 30 minutes."
        footer={backToSignIn}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div>
            <H2>Check your email</H2>
            <Sub>
              We sent a sign-in link to <span className="mono">{email}</span>.
            </Sub>
          </div>
          <SuccessBox>Email sent · just now</SuccessBox>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      eyebrow="Reset"
      title="Forgotten passwords happen."
      subtitle="We'll email a reset link. It expires in 30 minutes."
      footer={backToSignIn}
    >
      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: 22 }}
      >
        <div>
          <H2>Reset your password</H2>
          <Sub>Enter the email tied to your workspace.</Sub>
        </div>
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
        {error && <ErrorBox>{error}</ErrorBox>}
        <PrimaryBtn disabled={loading}>
          {loading ? "Sending…" : "Send reset link →"}
        </PrimaryBtn>
      </form>
    </AuthLayout>
  );
}

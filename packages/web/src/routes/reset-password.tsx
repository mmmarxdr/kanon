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
import { PasswordRequirements } from "@/components/password-requirements";
import { evaluatePassword, isPasswordValid } from "@/lib/password-policy";

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
  const [pwTouched, setPwTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  // Derived at render — no redundant state
  const requirements = evaluatePassword(password, confirmPassword);
  const valid = isPasswordValid(requirements);

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

  if (!token) {
    return (
      <AuthLayout
        eyebrow="Reset"
        title="Invalid reset link."
        subtitle="This password reset link is invalid or has expired."
        footer={backToSignIn}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div>
            <H2>Invalid reset link</H2>
            <Sub>
              Please request a new password reset link to continue.
            </Sub>
          </div>
          <PrimaryBtn
            type="button"
            onClick={() => void navigate({ to: "/forgot-password" })}
          >
            Request a new reset link →
          </PrimaryBtn>
        </div>
      </AuthLayout>
    );
  }

  if (success) {
    return (
      <AuthLayout
        eyebrow="Done"
        title="Password updated."
        subtitle="You can now sign in with your new password."
        footer={backToSignIn}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div>
            <H2>Password reset successful</H2>
            <Sub>Your password has been updated.</Sub>
          </div>
          <SuccessBox>You can now sign in.</SuccessBox>
          <PrimaryBtn type="button" onClick={() => void navigate({ to: "/login" })}>
            Sign in →
          </PrimaryBtn>
        </div>
      </AuthLayout>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!valid) {
      setError("Please ensure your password meets all requirements.");
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
    <AuthLayout
      eyebrow="Reset"
      title="Set a new password."
      subtitle="Choose a strong, unique password — at least 12 characters."
      footer={backToSignIn}
    >
      <form
        onSubmit={handleSubmit}
        data-testid="reset-password-form"
        style={{ display: "flex", flexDirection: "column", gap: 22 }}
      >
        <div>
          <H2>Set new password</H2>
          <Sub>You'll use this to sign in next time.</Sub>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <FormInput
            id="password"
            fieldLabel="New password"
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
          <FormInput
            id="confirmPassword"
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
          <PasswordRequirements requirements={pwTouched ? requirements : []} />
        </div>
        {error && <ErrorBox>{error}</ErrorBox>}
        <PrimaryBtn disabled={loading || !valid}>
          {loading ? "Resetting…" : "Reset password →"}
        </PrimaryBtn>
      </form>
    </AuthLayout>
  );
}

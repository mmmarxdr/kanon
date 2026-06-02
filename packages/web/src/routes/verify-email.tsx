import { createRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { rootRoute } from "./__root";
import { useAuthStore } from "@/stores/auth-store";
import {
  AuthLayout,
  ErrorBox,
  H2,
  PrimaryBtn,
  Sub,
  SuccessBox,
} from "@/components/auth-layout";

// ─── Testable inner component ─────────────────────────────────────────────────

interface VerifyEmailViewProps {
  token: string | undefined;
  onSuccess: () => Promise<void>;
}

export function VerifyEmailView({ token, onSuccess }: VerifyEmailViewProps) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"pending" | "success" | "error">(
    token ? "pending" : "error",
  );
  const [errorMessage, setErrorMessage] = useState<string>(
    token ? "" : "Invalid verification link.",
  );

  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    async function verify() {
      try {
        const res = await fetch("/api/auth/verify-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ token }),
        });

        if (cancelled) return;

        if (res.ok) {
          setStatus("success");
          await onSuccess();
        } else {
          let message = "This verification link is invalid or has expired.";
          try {
            const body = (await res.json()) as Record<string, unknown>;
            if (typeof body.message === "string") message = body.message;
          } catch {
            // Not JSON — use default message
          }
          setErrorMessage(message);
          setStatus("error");
        }
      } catch {
        if (!cancelled) {
          setErrorMessage("Could not connect. Please try again.");
          setStatus("error");
        }
      }
    }

    void verify();
    return () => {
      cancelled = true;
    };
  }, [token, onSuccess]);

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

  if (status === "pending") {
    return (
      <AuthLayout
        eyebrow="Verifying"
        title="Verifying your email…"
        subtitle="Please wait while we confirm your email address."
        footer={backToSignIn}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div>
            <H2>Verifying…</H2>
            <Sub>This should only take a moment.</Sub>
          </div>
        </div>
      </AuthLayout>
    );
  }

  if (status === "success") {
    return (
      <AuthLayout
        eyebrow="Done"
        title="Email verified."
        subtitle="Your email address has been confirmed."
        footer={backToSignIn}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div>
            <H2>Email verified</H2>
            <Sub>You're all set.</Sub>
          </div>
          <SuccessBox>Your email has been verified successfully.</SuccessBox>
          <PrimaryBtn type="button" onClick={() => void navigate({ to: "/workspaces" })}>
            Continue →
          </PrimaryBtn>
        </div>
      </AuthLayout>
    );
  }

  // error state
  return (
    <AuthLayout
      eyebrow="Error"
      title="Verification failed."
      subtitle="This link may have expired or already been used."
      footer={backToSignIn}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        <div>
          <H2>Invalid or expired link</H2>
          <Sub>Please request a new verification email.</Sub>
        </div>
        <ErrorBox>{errorMessage}</ErrorBox>
        <PrimaryBtn type="button" onClick={() => void navigate({ to: "/login" })}>
          Back to sign in →
        </PrimaryBtn>
      </div>
    </AuthLayout>
  );
}

// ─── Route ────────────────────────────────────────────────────────────────────

interface VerifyEmailSearch {
  token?: string;
}

export const verifyEmailRoute = createRoute({
  path: "/verify-email",
  getParentRoute: () => rootRoute,
  component: VerifyEmailPage,
  validateSearch: (search: Record<string, unknown>): VerifyEmailSearch => ({
    token: typeof search.token === "string" ? search.token : undefined,
  }),
});

function VerifyEmailPage() {
  const { token } = verifyEmailRoute.useSearch();
  const bootstrap = useAuthStore((s) => s.bootstrap);

  return <VerifyEmailView token={token} onSuccess={bootstrap} />;
}

import { createRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { rootRoute } from "./__root";
import { useAuthStore } from "@/stores/auth-store";
import { fetchApi } from "@/lib/api-client";
import type { AuthUser } from "@/stores/auth-store";
import {
  AuthLayout,
  ErrorBox,
  H2,
  PrimaryBtn,
  Sub,
} from "@/components/auth-layout";

// ─── Testable inner component ─────────────────────────────────────────────────

interface MagicLinkViewProps {
  token: string | undefined;
  onSuccess: (user: AuthUser) => void;
}

export function MagicLinkView({ token, onSuccess }: MagicLinkViewProps) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"pending" | "success" | "error">(
    token ? "pending" : "error",
  );
  const [errorMessage, setErrorMessage] = useState<string>(
    token ? "" : "Invalid sign-in link.",
  );

  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    async function redeem() {
      try {
        const res = await fetch("/api/auth/verify-magic-link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ token }),
        });

        if (cancelled) return;

        if (res.ok) {
          // Fetch current user to populate auth store
          const user = await fetchApi<AuthUser>("/api/auth/me");
          if (!cancelled) {
            setStatus("success");
            onSuccess(user);
            void navigate({ to: "/workspaces" });
          }
        } else {
          let message = "This sign-in link is invalid or has expired.";
          try {
            const body = (await res.json()) as Record<string, unknown>;
            if (typeof body.message === "string") message = body.message;
          } catch {
            // Not JSON — use default message
          }
          if (!cancelled) {
            setErrorMessage(message);
            setStatus("error");
          }
        }
      } catch {
        if (!cancelled) {
          setErrorMessage("Could not connect. Please try again.");
          setStatus("error");
        }
      }
    }

    void redeem();
    return () => {
      cancelled = true;
    };
  }, [token, onSuccess, navigate]);

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
        eyebrow="Signing in"
        title="Verifying your link…"
        subtitle="Please wait while we sign you in."
        footer={backToSignIn}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div>
            <H2>Signing in…</H2>
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
        title="Signed in."
        subtitle="You have been signed in successfully."
        footer={backToSignIn}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div>
            <H2>Signed in</H2>
            <Sub>Redirecting you to your workspace…</Sub>
          </div>
        </div>
      </AuthLayout>
    );
  }

  // error state
  return (
    <AuthLayout
      eyebrow="Error"
      title="Sign-in failed."
      subtitle="This link may have expired or already been used."
      footer={backToSignIn}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        <div>
          <H2>Invalid or expired link</H2>
          <Sub>Please request a new sign-in link from the login page.</Sub>
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

interface MagicLinkSearch {
  token?: string;
}

export const magicLinkRoute = createRoute({
  path: "/magic-link",
  getParentRoute: () => rootRoute,
  component: MagicLinkPage,
  validateSearch: (search: Record<string, unknown>): MagicLinkSearch => ({
    token: typeof search.token === "string" ? search.token : undefined,
  }),
});

function MagicLinkPage() {
  const { token } = magicLinkRoute.useSearch();
  const setUser = useAuthStore((s) => s.setUser);

  return <MagicLinkView token={token} onSuccess={setUser} />;
}

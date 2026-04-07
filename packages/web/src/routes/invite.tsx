import { createRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { rootRoute } from "./__root";
import { useAuthStore } from "@/stores/auth-store";
import { fetchApi, ApiError } from "@/lib/api-client";

interface InviteMetadata {
  workspaceName: string;
  workspaceSlug: string;
  role: string;
  expiresAt: string;
  isExpired: boolean;
  isExhausted: boolean;
  isRevoked: boolean;
  isValid: boolean;
}

export const inviteRoute = createRoute({
  path: "/invite/$token",
  getParentRoute: () => rootRoute,
  component: InvitePage,
});

function InvitePage() {
  const navigate = useNavigate();
  const { token } = inviteRoute.useParams();
  const { isAuthenticated, user } = useAuthStore();

  const [metadata, setMetadata] = useState<InviteMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchMetadata() {
      try {
        const data = await fetch(`/api/invites/${token}`, {
          credentials: "include",
        });
        if (!data.ok) {
          if (data.status === 404) {
            setError("This invite link is invalid or does not exist.");
          } else {
            setError("Failed to load invite details.");
          }
          return;
        }
        const meta = (await data.json()) as InviteMetadata;
        setMetadata(meta);
      } catch {
        setError("Failed to load invite details. Please try again.");
      } finally {
        setLoading(false);
      }
    }

    void fetchMetadata();
  }, [token]);

  async function handleAccept() {
    setAccepting(true);
    setAcceptError(null);

    try {
      await fetchApi(`/api/invites/${token}/accept`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      void navigate({ to: "/workspaces" });
    } catch (err) {
      if (err instanceof ApiError) {
        setAcceptError(err.message);
      } else {
        setAcceptError("Failed to accept invite. Please try again.");
      }
    } finally {
      setAccepting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading invite...</p>
        </div>
      </div>
    );
  }

  if (error || !metadata) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-sm animate-fade-in text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <svg className="h-6 w-6 text-destructive" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          </div>
          <h1 className="text-lg font-bold text-foreground mb-2">Invalid Invite</h1>
          <p className="text-sm text-muted-foreground mb-4">
            {error ?? "This invite link is not valid."}
          </p>
          <button
            onClick={() => void navigate({ to: "/login" })}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            Go to sign in
          </button>
        </div>
      </div>
    );
  }

  // Determine invalid states
  if (!metadata.isValid) {
    let reason = "This invite is no longer valid.";
    if (metadata.isRevoked) {
      reason = "This invite has been revoked by an administrator.";
    } else if (metadata.isExpired) {
      reason = "This invite has expired.";
    } else if (metadata.isExhausted) {
      reason = "This invite has reached its maximum number of uses.";
    }

    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-sm animate-fade-in text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <svg className="h-6 w-6 text-destructive" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>
          <h1 className="text-lg font-bold text-foreground mb-2">Invite Unavailable</h1>
          <p className="text-sm text-muted-foreground mb-4">{reason}</p>
          <button
            onClick={() => void navigate({ to: "/login" })}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            Go to sign in
          </button>
        </div>
      </div>
    );
  }

  // Format role for display
  const roleLabel = metadata.role.charAt(0).toUpperCase() + metadata.role.slice(1);

  // Format expiration
  const expiresDate = new Date(metadata.expiresAt);
  const expiresFormatted = expiresDate.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-sm animate-fade-in">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <svg className="h-6 w-6 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-foreground">
            Join <span className="text-primary">{metadata.workspaceName}</span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            You've been invited to join this workspace
          </p>
        </div>

        <div className="mb-6 space-y-3 rounded-md border border-border bg-muted/30 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Workspace</span>
            <span className="text-sm font-medium text-foreground">{metadata.workspaceName}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Your role</span>
            <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
              {roleLabel}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Expires</span>
            <span className="text-sm text-foreground">{expiresFormatted}</span>
          </div>
        </div>

        {acceptError && (
          <div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {acceptError}
          </div>
        )}

        {isAuthenticated && user ? (
          <div className="space-y-3">
            <p className="text-center text-sm text-muted-foreground">
              Signed in as <span className="font-medium text-foreground">{user.email}</span>
            </p>
            <button
              onClick={() => void handleAccept()}
              disabled={accepting}
              className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200 ease-out"
            >
              {accepting ? "Joining..." : "Accept Invite"}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <button
              onClick={() =>
                void navigate({
                  to: "/register",
                  search: { invite: token },
                })
              }
              className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-all duration-200 ease-out"
            >
              Sign up to join
            </button>
            <button
              onClick={() =>
                void navigate({
                  to: "/login",
                  search: { invite: token },
                })
              }
              className="w-full rounded-md border border-input bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-all duration-200 ease-out"
            >
              Log in to join
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

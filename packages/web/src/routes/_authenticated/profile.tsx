import { createRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { authenticatedRoute } from "../_authenticated";
import { useAuthStore } from "@/stores/auth-store";
import { fetchApi, ApiError } from "@/lib/api-client";
import type { AuthUser } from "@/stores/auth-store";
import { PasswordRequirements } from "@/components/password-requirements";
import { evaluatePassword, isPasswordValid } from "@/lib/password-policy";
import { useActiveWorkspaceId, useWorkspacesQuery } from "@/hooks/use-workspace-query";
import { NotificationPreferencesSection } from "@/features/settings/notification-preferences-section";
import { SettingsShell } from "@/components/ui/settings-shell";

export const profileRoute = createRoute({
  path: "/profile",
  getParentRoute: () => authenticatedRoute,
  component: ProfilePage,
});

interface ProfileData {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export function ProfilePage() {
  const { t } = useTranslation("settings");
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const activeWorkspaceId = useActiveWorkspaceId();
  const { data: workspaces, isLoading: workspacesLoading } = useWorkspacesQuery();
  const activeWorkspace = workspaces?.find((w) => w.id === activeWorkspaceId);

  // Profile form state
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? "");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Change password form state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwTouched, setPwTouched] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Derived at render — no redundant state
  const pwRequirements = evaluatePassword(newPassword, confirmPassword);
  const pwValid = isPasswordValid(pwRequirements);

  async function handleProfileSubmit(e: React.FormEvent) {
    e.preventDefault();
    setProfileError(null);
    setProfileSuccess(null);
    setProfileSaving(true);

    try {
      const updated = await fetchApi<ProfileData>("/api/auth/me", {
        method: "PATCH",
        body: JSON.stringify({
          displayName: displayName || null,
          avatarUrl: avatarUrl || null,
        }),
      });

      // Update the auth store with new profile data
      if (user) {
        setUser({
          ...user,
          displayName: updated.displayName,
          avatarUrl: updated.avatarUrl,
        });
      }

      setProfileSuccess("Profile updated successfully.");
    } catch (err) {
      if (err instanceof ApiError) {
        setProfileError(err.message);
      } else {
        setProfileError("Failed to update profile.");
      }
    } finally {
      setProfileSaving(false);
    }
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);

    if (!pwValid) {
      setPasswordError("Please ensure your password meets all requirements.");
      return;
    }

    setPasswordSaving(true);

    try {
      await fetchApi("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      setPasswordSuccess("Password changed successfully.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      if (err instanceof ApiError) {
        setPasswordError(err.message);
      } else {
        setPasswordError("Failed to change password.");
      }
    } finally {
      setPasswordSaving(false);
    }
  }

  if (!user) return null;

  const initials = (user.displayName ?? user.email)
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <SettingsShell title="Profile">
      <div className="space-y-8">
        {/* User Info Card */}
        <div className="rounded-lg border border-border bg-card p-6">
          <div className="flex items-center gap-4 mb-6">
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt="Avatar"
                className="h-16 w-16 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground text-xl font-semibold">
                {initials}
              </div>
            )}
            <div>
              <p className="text-lg font-medium text-foreground">
                {user.displayName ?? user.email}
              </p>
              <p className="text-sm text-muted-foreground">{user.email}</p>
            </div>
          </div>

          <form onSubmit={(e) => { void handleProfileSubmit(e); }} className="space-y-4">
            <div className="space-y-2">
              <label
                htmlFor="displayName"
                className="text-sm font-medium text-card-foreground"
              >
                Display Name
              </label>
              <input
                id="displayName"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your display name"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 transition-all duration-150 ease-out"
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="avatarUrl"
                className="text-sm font-medium text-card-foreground"
              >
                Avatar URL
              </label>
              <input
                id="avatarUrl"
                type="url"
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                placeholder="https://example.com/avatar.png"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 transition-all duration-150 ease-out"
              />
            </div>

            {profileSuccess && (
              <div className="rounded-md border border-success/50 bg-success/10 px-3 py-2 text-sm text-success">
                {profileSuccess}
              </div>
            )}

            {profileError && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {profileError}
              </div>
            )}

            <button
              type="submit"
              disabled={profileSaving}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200 ease-out"
            >
              {profileSaving ? "Saving..." : "Save Profile"}
            </button>
          </form>
        </div>

        {/* Change Password Card */}
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">
            Change Password
          </h2>

          <form onSubmit={(e) => { void handlePasswordSubmit(e); }} className="space-y-4">
            <div className="space-y-2">
              <label
                htmlFor="currentPassword"
                className="text-sm font-medium text-card-foreground"
              >
                Current Password
              </label>
              <input
                id="currentPassword"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
                required
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 transition-all duration-150 ease-out"
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="newPassword"
                className="text-sm font-medium text-card-foreground"
              >
                New Password
              </label>
              <input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  if (!pwTouched) setPwTouched(true);
                }}
                placeholder="At least 12 characters"
                required
                minLength={12}
                maxLength={128}
                aria-describedby="password-requirements"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 transition-all duration-150 ease-out"
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="confirmPassword"
                className="text-sm font-medium text-card-foreground"
              >
                Confirm New Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  if (!pwTouched) setPwTouched(true);
                }}
                placeholder="Confirm new password"
                required
                minLength={12}
                maxLength={128}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 transition-all duration-150 ease-out"
              />
            </div>

            <PasswordRequirements requirements={pwTouched ? pwRequirements : []} />

            {passwordSuccess && (
              <div className="rounded-md border border-success/50 bg-success/10 px-3 py-2 text-sm text-success">
                {passwordSuccess}
              </div>
            )}

            {passwordError && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {passwordError}
              </div>
            )}

            <button
              type="submit"
              disabled={passwordSaving || !pwValid}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200 ease-out"
            >
              {passwordSaving ? "Changing..." : "Change Password"}
            </button>
          </form>
        </div>

        {/* Notification Preferences */}
        <div className="space-y-2">
          {workspacesLoading ? (
            <div className="rounded-lg border border-border bg-card p-6">
              <p className="text-sm text-muted-foreground">
                {t("profileNotificationsLoading")}
              </p>
            </div>
          ) : activeWorkspace ? (
            <>
              <p className="px-1 text-sm text-muted-foreground">
                {t("profileNotificationsFor", { name: activeWorkspace.name })}
              </p>
              <NotificationPreferencesSection workspaceId={activeWorkspace.id} />
            </>
          ) : (
            <div className="rounded-lg border border-border bg-card p-6">
              <p className="text-sm text-muted-foreground">{t("noWorkspace")}</p>
            </div>
          )}
        </div>
      </div>
    </SettingsShell>
  );
}

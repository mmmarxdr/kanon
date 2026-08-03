/**
 * /admin/instance — Super-admin instance settings page (KAN-49).
 *
 * On mount: fetches GET /api/instance/settings via fetchApi.
 *  - 403 FORBIDDEN → navigate to / (not super-admin)
 *  - 401 UNAUTHORIZED → navigate to /login (not authenticated)
 *  - 200 → render settings form
 *
 * The _authenticated parent route handles the base auth guard (redirects to
 * /login if no session). This route adds the super-admin check: if the
 * authenticated user is not the instance owner, they see a redirect to /.
 *
 * Pattern: in-component useEffect fetch + navigate (mirrors invite.tsx).
 * Extracted presentational component (AdminInstanceForm) for testability.
 *
 * signupMode and allowedSignupDomains are shown read-only with a note that
 * they are not enforced yet (layer 2 deferred per spec).
 */
import { createRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { authenticatedRoute } from "../_authenticated";
import { fetchApi, ApiError } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { SUPPORTED_LOCALES } from "@kanon/shared";
import { AdminRedmineSection } from "@/features/settings/admin-redmine-section";
import { SettingsShell } from "@/components/ui/settings-shell";
import { SettingsCard } from "@/components/ui/settings-card";
import { SettingsField, SETTINGS_INPUT_CLASS } from "@/components/ui/settings-field";

// ─── Types ────────────────────────────────────────────────────────────────────

interface InstanceAdminInviteResponse {
  inviteId: string;
  url: string;
  token: string;
  expiresAt: string;
}

interface InstanceSettings {
  id: string;
  instanceName: string | null;
  signupMode: string;
  allowedSignupDomains: string[];
  /** Locale used for outbound transactional emails (KAN-203 Slice 2). */
  defaultLocale: string;
  redmineBaseUrl: string | null;
  ownerUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Route definition ─────────────────────────────────────────────────────────

export const adminInstanceRoute = createRoute({
  path: "/admin/instance",
  getParentRoute: () => authenticatedRoute,
  component: AdminInstancePage,
});

// ─── Presentational form — extracted for testability ─────────────────────────

interface AdminInstanceFormProps {
  onNavigate: ReturnType<typeof useNavigate>;
}

export function AdminInstanceForm({ onNavigate }: AdminInstanceFormProps) {
  const { t } = useTranslation("settings");
  const user = useAuthStore((s) => s.user);

  const [settings, setSettings] = useState<InstanceSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [instanceName, setInstanceName] = useState("");
  const [signupMode, setSignupMode] = useState("open");
  const [allowedDomains, setAllowedDomains] = useState("");
  const [defaultLocale, setDefaultLocale] = useState("en");
  const [redmineBaseUrl, setRedmineBaseUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Invite-admin state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteResult, setInviteResult] = useState<InstanceAdminInviteResponse | null>(null);

  // On mount: load settings; redirect on auth/authz failure
  useEffect(() => {
    async function loadSettings() {
      try {
        const data = await fetchApi<InstanceSettings>("/api/instance/settings");
        setSettings(data);
        setInstanceName(data.instanceName ?? "");
        setSignupMode(data.signupMode);
        setAllowedDomains(data.allowedSignupDomains.join(", "));
        setDefaultLocale(data.defaultLocale);
        setRedmineBaseUrl(data.redmineBaseUrl ?? "");
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.status === 403) {
            void onNavigate({ to: "/" });
            return;
          }
          if (err.status === 401) {
            void onNavigate({ to: "/login" });
            return;
          }
        }
        // Other errors — show inline
        setSaveError("Failed to load settings");
      } finally {
        setLoading(false);
      }
    }

    void loadSettings();
  }, [onNavigate]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      // Parse domains: split by comma/newline, trim, filter empty
      const parsedDomains = allowedDomains
        .split(/[\n,]/)
        .map((d) => d.trim())
        .filter(Boolean);

      const updated = await fetchApi<InstanceSettings>("/api/instance/settings", {
        method: "PATCH",
        body: JSON.stringify({
          instanceName: instanceName || null,
          signupMode,
          allowedSignupDomains: parsedDomains,
          defaultLocale,
          redmineBaseUrl: redmineBaseUrl.trim() || null,
        }),
      });
      setSettings(updated);
      setInstanceName(updated.instanceName ?? "");
      setSignupMode(updated.signupMode);
      setAllowedDomains(updated.allowedSignupDomains.join(", "));
      setDefaultLocale(updated.defaultLocale);
      setRedmineBaseUrl(updated.redmineBaseUrl ?? "");
      setSaveSuccess(true);
    } catch (err) {
      if (err instanceof ApiError) {
        setSaveError(err.message);
      } else {
        setSaveError("An unexpected error occurred");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleInviteAdmin(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteError(null);
    setInviteResult(null);

    try {
      const result = await fetchApi<InstanceAdminInviteResponse>(
        "/api/instance/admins/invites",
        {
          method: "POST",
          body: JSON.stringify({ email: inviteEmail.trim() }),
        },
      );
      setInviteResult(result);
      setInviteEmail("");
    } catch (err) {
      if (err instanceof ApiError) {
        setInviteError(err.message);
      } else {
        setInviteError("An unexpected error occurred");
      }
    } finally {
      setInviting(false);
    }
  }

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          height: "100%",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: "50%",
            border: "2px solid var(--accent)",
            borderTopColor: "transparent",
            animation: "spin 0.8s linear infinite",
          }}
        />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!settings) {
    return (
      <div style={{ padding: "24px 28px" }}>
        {saveError && (
          <p style={{ color: "var(--bad)", fontSize: 13 }}>{saveError}</p>
        )}
      </div>
    );
  }

  return (
    <SettingsShell title="Instance Settings" eyebrow="super-admin">
      {user?.isSuperAdmin && (
        <SettingsCard
          testId="invite-admin-section"
          title="Invite instance admin"
          description="Generate a kanon:// onboarding link that grants the instance-admin role."
        >
          <form
            onSubmit={(e) => { void handleInviteAdmin(e); }}
            className="flex flex-col gap-3"
          >
            <SettingsField label="Email" htmlFor="inviteAdminEmail" span="full">
              <input
                id="inviteAdminEmail"
                data-testid="invite-admin-email"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="newadmin@company.com"
                required
                className={SETTINGS_INPUT_CLASS}
              />
            </SettingsField>

            {inviteError && (
              <div
                data-testid="invite-admin-error"
                className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {inviteError}
              </div>
            )}

            {inviteResult && (
              <div
                data-testid="invite-admin-result"
                className="rounded-md border border-success/50 bg-success/10 px-3 py-2 text-sm flex flex-col gap-1"
              >
                <span className="font-medium text-success">
                  Invite link generated — share with the new admin:
                </span>
                <code className="text-xs text-muted-foreground break-all font-mono">
                  {inviteResult.url}
                </code>
              </div>
            )}

            <button
              type="submit"
              data-testid="invite-admin-submit"
              disabled={inviting || !inviteEmail.trim()}
              className="self-start rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200 ease-out"
            >
              {inviting ? "Sending…" : "Generate invite link"}
            </button>
          </form>
        </SettingsCard>
      )}

      <SettingsCard testId="admin-instance-form">
        <form
          onSubmit={(e) => { void handleSave(e); }}
          className="md:grid md:grid-cols-2 md:gap-x-6 md:gap-y-4"
        >
          <SettingsField label="Instance name" htmlFor="instanceName" span="full">
            <input
              id="instanceName"
              data-testid="instance-name-input"
              type="text"
              value={instanceName}
              onChange={(e) => setInstanceName(e.target.value)}
              maxLength={120}
              placeholder="e.g. Acme Corp Kanon"
              className={SETTINGS_INPUT_CLASS}
            />
          </SettingsField>

          <SettingsField label="Signup mode" htmlFor="signupMode">
            <select
              id="signupMode"
              data-testid="signup-mode-select"
              value={signupMode}
              onChange={(e) => setSignupMode(e.target.value)}
              className={SETTINGS_INPUT_CLASS}
            >
              <option value="open">open — anyone can register</option>
              <option value="invite">invite — invite token required</option>
              <option value="closed">closed — no new registrations</option>
            </select>
          </SettingsField>

          <SettingsField
            label="Allowed signup domains"
            htmlFor="allowedDomains"
            hint="(comma-separated, leave empty to allow all)"
          >
            <input
              id="allowedDomains"
              data-testid="allowed-domains-input"
              type="text"
              value={allowedDomains}
              onChange={(e) => setAllowedDomains(e.target.value)}
              placeholder="acme.com, corp.io"
              className={SETTINGS_INPUT_CLASS}
            />
          </SettingsField>

          <SettingsField
            label={t("instance.redmineBaseUrl")}
            htmlFor="redmineBaseUrl"
            hint={t("instance.redmineBaseUrlHelp")}
          >
            <input
              id="redmineBaseUrl"
              data-testid="redmine-base-url-input"
              type="url"
              value={redmineBaseUrl}
              onChange={(e) => setRedmineBaseUrl(e.target.value)}
              maxLength={2048}
              placeholder="https://redmine.example.com"
              className={SETTINGS_INPUT_CLASS}
            />
          </SettingsField>

          <SettingsField
            label={t("instance.defaultLocale")}
            htmlFor="defaultLocale"
            hint={t("instance.defaultLocaleHelp")}
          >
            <select
              id="defaultLocale"
              data-testid="default-locale-select"
              value={defaultLocale}
              onChange={(e) => setDefaultLocale(e.target.value)}
              className={SETTINGS_INPUT_CLASS}
            >
              {SUPPORTED_LOCALES.map((locale) => (
                <option key={locale.code} value={locale.code}>
                  {locale.label}
                </option>
              ))}
            </select>
          </SettingsField>

          {saveError && (
            <div
              data-testid="save-error"
              className="md:col-span-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {saveError}
            </div>
          )}

          {saveSuccess && (
            <div
              data-testid="save-success"
              className="md:col-span-2 rounded-md border border-success/50 bg-success/10 px-3 py-2 text-sm text-success"
            >
              Settings saved.
            </div>
          )}

          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200 ease-out"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </SettingsCard>

      <AdminRedmineSection redmineBaseUrl={settings.redmineBaseUrl} />
    </SettingsShell>
  );
}

// ─── Route wrapper ────────────────────────────────────────────────────────────

function AdminInstancePage() {
  const navigate = useNavigate();
  return <AdminInstanceForm onNavigate={navigate} />;
}

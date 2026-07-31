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
        }),
      });
      setSettings(updated);
      setInstanceName(updated.instanceName ?? "");
      setSignupMode(updated.signupMode);
      setAllowedDomains(updated.allowedSignupDomains.join(", "));
      setDefaultLocale(updated.defaultLocale);
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
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg)",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "20px 28px 0",
          borderBottom: "1px solid var(--line)",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <h1
            style={{
              margin: 0,
              fontSize: 20,
              fontWeight: 600,
              letterSpacing: "-0.02em",
            }}
          >
            Instance Settings
          </h1>
          <span
            style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "monospace" }}
          >
            super-admin
          </span>
        </div>
      </div>

      {/* Body */}
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "24px 28px 28px",
        }}
      >
        <div style={{ maxWidth: 560, display: "flex", flexDirection: "column", gap: 24 }}>
          {/* ── Invite-admin section (gated on isSuperAdmin — only super-admin may mint invites) ── */}
          {user?.isSuperAdmin && (
            <div
              data-testid="invite-admin-section"
              style={{
                padding: "16px",
                background: "var(--bg-2)",
                border: "1px solid var(--line)",
                borderRadius: 6,
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <div>
                <h2
                  style={{
                    margin: 0,
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--ink)",
                    marginBottom: 4,
                  }}
                >
                  Invite instance admin
                </h2>
                <p style={{ margin: 0, fontSize: 11, color: "var(--ink-3)" }}>
                  Generate a kanon:// onboarding link that grants the instance-admin role.
                </p>
              </div>

              <form
                onSubmit={(e) => { void handleInviteAdmin(e); }}
                style={{ display: "flex", flexDirection: "column", gap: 10 }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    height: 36,
                    border: "1px solid var(--line-2)",
                    borderRadius: 5,
                    background: "var(--panel)",
                    padding: "0 10px",
                  }}
                >
                  <input
                    id="inviteAdminEmail"
                    data-testid="invite-admin-email"
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="newadmin@company.com"
                    required
                    style={{
                      flex: 1,
                      height: "100%",
                      border: 0,
                      outline: 0,
                      background: "transparent",
                      color: "var(--ink)",
                      fontSize: 13,
                    }}
                  />
                </div>

                {inviteError && (
                  <div
                    data-testid="invite-admin-error"
                    style={{
                      padding: "6px 10px",
                      background: "color-mix(in oklch, var(--bad) 12%, transparent)",
                      border: "1px solid color-mix(in oklch, var(--bad) 40%, transparent)",
                      borderRadius: 4,
                      color: "var(--bad)",
                      fontSize: 12,
                    }}
                  >
                    {inviteError}
                  </div>
                )}

                {inviteResult && (
                  <div
                    data-testid="invite-admin-result"
                    style={{
                      padding: "8px 10px",
                      background: "color-mix(in oklch, var(--ok) 10%, transparent)",
                      border: "1px solid color-mix(in oklch, var(--ok) 35%, transparent)",
                      borderRadius: 4,
                      fontSize: 12,
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    <span style={{ color: "var(--ok)", fontWeight: 500 }}>
                      Invite link generated — share with the new admin:
                    </span>
                    <code
                      style={{
                        fontSize: 11,
                        color: "var(--ink-2)",
                        wordBreak: "break-all",
                        fontFamily: "monospace",
                      }}
                    >
                      {inviteResult.url}
                    </code>
                  </div>
                )}

                <button
                  type="submit"
                  data-testid="invite-admin-submit"
                  disabled={inviting || !inviteEmail.trim()}
                  style={{
                    alignSelf: "flex-start",
                    height: 32,
                    padding: "0 16px",
                    background: "var(--accent)",
                    color: "var(--btn-ink)",
                    borderRadius: 4,
                    fontSize: 12,
                    fontWeight: 500,
                    opacity: inviting || !inviteEmail.trim() ? 0.55 : 1,
                    cursor: inviting || !inviteEmail.trim() ? "not-allowed" : "pointer",
                  }}
                >
                  {inviting ? "Sending…" : "Generate invite link"}
                </button>
              </form>
            </div>
          )}

          <form
            onSubmit={(e) => { void handleSave(e); }}
            data-testid="admin-instance-form"
            style={{ display: "flex", flexDirection: "column", gap: 16 }}
          >
            {/* instanceName */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label
                htmlFor="instanceName"
                style={{ fontSize: 11, color: "var(--ink-3)", fontWeight: 500 }}
              >
                Instance name
              </label>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  height: 36,
                  border: "1px solid var(--line-2)",
                  borderRadius: 5,
                  background: "var(--panel)",
                  padding: "0 10px",
                }}
              >
                <input
                  id="instanceName"
                  data-testid="instance-name-input"
                  type="text"
                  value={instanceName}
                  onChange={(e) => setInstanceName(e.target.value)}
                  maxLength={120}
                  placeholder="e.g. Acme Corp Kanon"
                  style={{
                    flex: 1,
                    height: "100%",
                    border: 0,
                    outline: 0,
                    background: "transparent",
                    color: "var(--ink)",
                    fontSize: 13,
                  }}
                />
              </div>
            </div>

            {/* Signup mode — editable select */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label
                htmlFor="signupMode"
                style={{ fontSize: 11, color: "var(--ink-3)", fontWeight: 500 }}
              >
                Signup mode
              </label>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  height: 36,
                  border: "1px solid var(--line-2)",
                  borderRadius: 5,
                  background: "var(--panel)",
                  padding: "0 10px",
                }}
              >
                <select
                  id="signupMode"
                  data-testid="signup-mode-select"
                  value={signupMode}
                  onChange={(e) => setSignupMode(e.target.value)}
                  style={{
                    flex: 1,
                    height: "100%",
                    border: 0,
                    outline: 0,
                    background: "transparent",
                    color: "var(--ink)",
                    fontSize: 13,
                  }}
                >
                  <option value="open">open — anyone can register</option>
                  <option value="invite">invite — invite token required</option>
                  <option value="closed">closed — no new registrations</option>
                </select>
              </div>
            </div>

            {/* Allowed signup domains — editable */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label
                htmlFor="allowedDomains"
                style={{ fontSize: 11, color: "var(--ink-3)", fontWeight: 500 }}
              >
                Allowed signup domains
                <span style={{ marginLeft: 6, fontSize: 10, color: "var(--ink-4)", fontWeight: 400 }}>
                  (comma-separated, leave empty to allow all)
                </span>
              </label>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  height: 36,
                  border: "1px solid var(--line-2)",
                  borderRadius: 5,
                  background: "var(--panel)",
                  padding: "0 10px",
                }}
              >
                <input
                  id="allowedDomains"
                  data-testid="allowed-domains-input"
                  type="text"
                  value={allowedDomains}
                  onChange={(e) => setAllowedDomains(e.target.value)}
                  placeholder="acme.com, corp.io"
                  style={{
                    flex: 1,
                    height: "100%",
                    border: 0,
                    outline: 0,
                    background: "transparent",
                    color: "var(--ink)",
                    fontSize: 13,
                  }}
                />
              </div>
            </div>

            {/* Default email locale — instance-wide, selects language of outbound emails */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label
                htmlFor="defaultLocale"
                style={{ fontSize: 11, color: "var(--ink-3)", fontWeight: 500 }}
              >
                {t("instance.defaultLocale")}
                <span style={{ marginLeft: 6, fontSize: 10, color: "var(--ink-4)", fontWeight: 400 }}>
                  {t("instance.defaultLocaleHelp")}
                </span>
              </label>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  height: 36,
                  border: "1px solid var(--line-2)",
                  borderRadius: 5,
                  background: "var(--panel)",
                  padding: "0 10px",
                }}
              >
                <select
                  id="defaultLocale"
                  data-testid="default-locale-select"
                  value={defaultLocale}
                  onChange={(e) => setDefaultLocale(e.target.value)}
                  style={{
                    flex: 1,
                    height: "100%",
                    border: 0,
                    outline: 0,
                    background: "transparent",
                    color: "var(--ink)",
                    fontSize: 13,
                  }}
                >
                  {SUPPORTED_LOCALES.map((locale) => (
                    <option key={locale.code} value={locale.code}>
                      {locale.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {saveError && (
              <div
                data-testid="save-error"
                style={{
                  padding: "8px 12px",
                  background: "color-mix(in oklch, var(--bad) 12%, transparent)",
                  border: "1px solid color-mix(in oklch, var(--bad) 40%, transparent)",
                  borderRadius: 5,
                  color: "var(--bad)",
                  fontSize: 12,
                }}
              >
                {saveError}
              </div>
            )}

            {saveSuccess && (
              <div
                data-testid="save-success"
                style={{
                  padding: "8px 12px",
                  background: "color-mix(in oklch, var(--ok) 12%, transparent)",
                  border: "1px solid color-mix(in oklch, var(--ok) 40%, transparent)",
                  borderRadius: 5,
                  color: "var(--ok)",
                  fontSize: 12,
                }}
              >
                Settings saved.
              </div>
            )}

            <button
              type="submit"
              disabled={saving}
              style={{
                alignSelf: "flex-start",
                height: 34,
                padding: "0 18px",
                background: "var(--accent)",
                color: "var(--btn-ink)",
                borderRadius: 5,
                fontSize: 13,
                fontWeight: 500,
                opacity: saving ? 0.55 : 1,
                cursor: saving ? "not-allowed" : "pointer",
              }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ─── Route wrapper ────────────────────────────────────────────────────────────

function AdminInstancePage() {
  const navigate = useNavigate();
  return <AdminInstanceForm onNavigate={navigate} />;
}

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
import { authenticatedRoute } from "../_authenticated";
import { fetchApi, ApiError } from "@/lib/api-client";

// ─── Types ────────────────────────────────────────────────────────────────────

interface InstanceSettings {
  id: string;
  instanceName: string | null;
  signupMode: string;
  allowedSignupDomains: string[];
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
  const [settings, setSettings] = useState<InstanceSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [instanceName, setInstanceName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // On mount: load settings; redirect on auth/authz failure
  useEffect(() => {
    async function loadSettings() {
      try {
        const data = await fetchApi<InstanceSettings>("/api/instance/settings");
        setSettings(data);
        setInstanceName(data.instanceName ?? "");
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
      const updated = await fetchApi<InstanceSettings>("/api/instance/settings", {
        method: "PATCH",
        body: JSON.stringify({ instanceName: instanceName || null }),
      });
      setSettings(updated);
      setInstanceName(updated.instanceName ?? "");
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
          <form
            onSubmit={handleSave}
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

            {/* Deferred fields — read-only display */}
            <div
              style={{
                padding: "12px 14px",
                background: "var(--bg-2)",
                border: "1px solid var(--line)",
                borderRadius: 5,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                  Signup mode
                </span>
                <span style={{ fontSize: 12, color: "var(--ink-2)" }}>
                  {settings.signupMode}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                  Allowed signup domains
                </span>
                <span style={{ fontSize: 12, color: "var(--ink-2)" }}>
                  {settings.allowedSignupDomains.length > 0
                    ? settings.allowedSignupDomains.join(", ")
                    : "none"}
                </span>
              </div>
              <p style={{ margin: 0, fontSize: 11, color: "var(--ink-4)", fontStyle: "italic" }}>
                Signup mode and allowed domains are stored but not enforced yet —
                coming in signup-control (layer 2).
              </p>
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

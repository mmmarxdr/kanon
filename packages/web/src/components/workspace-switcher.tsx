import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Monogram, Icon } from "@/components/ui/icons";
import {
  useActiveWorkspaceId,
  useSetActiveWorkspace,
  useWorkspacesQuery,
} from "@/hooks/use-workspace-query";

interface WorkspaceSwitcherProps {
  collapsed?: boolean;
}

/**
 * Sidebar header control: shows active workspace name; opens a list to switch
 * quickly. Switching sets active id, invalidates projects, navigates to /inbox.
 * “Manage / create” links to the existing /workspaces page.
 */
export function WorkspaceSwitcher({ collapsed = false }: WorkspaceSwitcherProps) {
  const { t } = useTranslation("nav");
  const navigate = useNavigate();
  const { data: workspaces } = useWorkspacesQuery();
  const activeId = useActiveWorkspaceId();
  const setActiveWorkspace = useSetActiveWorkspace();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const active = workspaces?.find((w) => w.id === activeId);
  const label = active?.name ?? t("workspaceFallback");

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function handleSelect(workspaceId: string) {
    if (workspaceId === activeId) {
      setOpen(false);
      return;
    }
    setActiveWorkspace(workspaceId);
    setOpen(false);
    void navigate({ to: "/inbox" });
  }

  function handleManage() {
    setOpen(false);
    void navigate({ to: "/workspaces" });
  }

  return (
    <div ref={rootRef} style={{ position: "relative", width: "100%" }}>
      <button
        type="button"
        data-testid="workspace-switcher"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={t("switchWorkspace")}
        title={label}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          height: 44,
          padding: collapsed ? "10px 0" : "10px 12px",
          justifyContent: collapsed ? "center" : "flex-start",
          background: "transparent",
          border: "none",
          borderBottom: "1px solid var(--line)",
          cursor: "pointer",
          color: "var(--ink)",
          textAlign: "left",
        }}
      >
        <Monogram size={20} />
        {!collapsed && (
          <>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                lineHeight: 1.1,
                minWidth: 0,
                flex: 1,
              }}
            >
              <span
                style={{
                  fontWeight: 600,
                  fontSize: 13,
                  letterSpacing: "-0.01em",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {label}
              </span>
              <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>
                {t("workspace")}
              </span>
            </div>
            <Icon.ChevD
              style={{
                width: 12,
                height: 12,
                color: "var(--ink-4)",
                flexShrink: 0,
                transform: open ? "rotate(180deg)" : "none",
                transition: "transform 120ms",
              }}
            />
          </>
        )}
      </button>

      {open && (
        <div
          data-testid="workspace-switcher-menu"
          role="listbox"
          aria-label={t("switchWorkspace")}
          style={{
            position: "absolute",
            top: "100%",
            left: collapsed ? 4 : 8,
            right: collapsed ? undefined : 8,
            width: collapsed ? 220 : undefined,
            zIndex: 50,
            marginTop: 4,
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: 6,
            boxShadow: "0 8px 24px color-mix(in oklch, var(--ink) 12%, transparent)",
            padding: 4,
            maxHeight: 280,
            overflow: "auto",
          }}
        >
          {(workspaces ?? []).map((ws) => {
            const selected = ws.id === activeId;
            return (
              <button
                key={ws.id}
                type="button"
                role="option"
                aria-selected={selected}
                data-testid={`workspace-switcher-item-${ws.slug}`}
                onClick={() => handleSelect(ws.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  padding: "8px 10px",
                  border: "none",
                  borderRadius: 4,
                  background: selected ? "var(--bg-2)" : "transparent",
                  color: "var(--ink)",
                  fontSize: 13,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span
                  style={{
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {ws.name}
                </span>
                {selected && (
                  <span className="mono" style={{ fontSize: 10, color: "var(--accent)" }}>
                    ✓
                  </span>
                )}
              </button>
            );
          })}
          <div
            style={{
              height: 1,
              background: "var(--line)",
              margin: "4px 0",
            }}
          />
          <button
            type="button"
            data-testid="workspace-switcher-manage"
            onClick={handleManage}
            style={{
              display: "block",
              width: "100%",
              padding: "8px 10px",
              border: "none",
              borderRadius: 4,
              background: "transparent",
              color: "var(--ink-2)",
              fontSize: 12,
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            {t("manageWorkspaces")}
          </button>
        </div>
      )}
    </div>
  );
}

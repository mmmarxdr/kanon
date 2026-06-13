import type { ReactNode } from "react";
import { useCollapsedState } from "./use-collapsed-state";
import type { SectionId } from "./collapsible-section-ids";

/**
 * KAN-108 slice 3 — CollapsibleSection disclosure primitive.
 *
 * WAI-ARIA disclosure pattern:
 * - Header is a <button> with aria-expanded and aria-controls pointing to panel.
 * - Panel <div id={panelId}> is conditionally rendered (unmounted when collapsed),
 *   not just hidden — this is the perf win (no Mermaid mounting while collapsed).
 * - Chevron is decorative (aria-hidden).
 *
 * Persistence: useCollapsedState writes to sessionStorage on every toggle.
 * Gracefully falls back to in-memory state if sessionStorage is unavailable.
 */

export interface CollapsibleSectionProps {
  /** Stable section identifier — used for sessionStorage key + testid */
  sectionId: SectionId;
  /** Label text displayed in the header */
  title: string;
  /** Optional count badge */
  count?: number;
  /** Issue key for sessionStorage namespacing */
  issueKey: string;
  /** Initial collapsed state when no stored value exists (default: false) */
  defaultCollapsed?: boolean;
  children: ReactNode;
}

export function CollapsibleSection({
  sectionId,
  title,
  count,
  issueKey,
  defaultCollapsed = false,
  children,
}: CollapsibleSectionProps) {
  const [collapsed, toggle] = useCollapsedState(
    issueKey,
    sectionId,
    defaultCollapsed,
  );

  const panelId = `collapsible-panel-${issueKey}-${sectionId}`;
  const buttonId = `collapsible-btn-${issueKey}-${sectionId}`;

  return (
    <div>
      {/* ── Header ── */}
      <button
        id={buttonId}
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-controls={collapsed ? undefined : panelId}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          marginBottom: 8,
        }}
      >
        {/* Label */}
        <span
          className="mono"
          style={{
            fontSize: 10,
            color: "var(--ink-4)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          {title}
        </span>

        {/* Count badge */}
        {count !== undefined && (
          <span
            className="mono"
            style={{
              fontSize: 10,
              color: "var(--ink-4)",
            }}
          >
            {count}
          </span>
        )}

        {/* Spacer + chevron */}
        <span style={{ flex: 1 }} />
        <ChevronIcon collapsed={collapsed} />
      </button>

      {/* ── Panel — conditionally rendered (unmounted when collapsed) ── */}
      {!collapsed && (
        <div
          id={panelId}
          role="region"
          aria-labelledby={buttonId}
          data-testid={`collapsible-section-${sectionId}`}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/* ─── Chevron icon (decorative) ──────────────────────────────────────────── */

function ChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      aria-hidden
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      style={{
        transition: "transform 0.15s ease",
        transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
        color: "var(--ink-4)",
      }}
    >
      <path
        d="M2 3.5L5 6.5L8 3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

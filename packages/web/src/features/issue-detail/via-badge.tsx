/**
 * KAN-32 — ViaBadge: provenance badge for timeline items.
 *
 * Renders a cobalt badge (oklch(0.52 0.11 245)) with Icon.Spark and a
 * human-readable label when `via` is a recognized AI-tool value.
 *
 * Renders nothing when:
 *   - via is null (pre-KAN-30 row, no provenance)
 *   - via is "web" (authored in the web UI — no badge needed)
 *   - via is an unrecognized value (forward-compatible — silently ignored)
 *
 * Design: mirrors the agent-thread badge markup (className="mono", Icon.Spark)
 * but uses cobalt instead of var(--ai).
 */

import { Icon } from "@/components/ui/icons";

const VIA_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  cursor: "Cursor",
  antigravity: "Antigravity",
  cli: "CLI",
};

interface ViaBadgeProps {
  via: string | null;
}

export function ViaBadge({ via }: ViaBadgeProps) {
  if (via === null || via === "web" || !(via in VIA_LABELS)) {
    return null;
  }

  const label = VIA_LABELS[via];

  return (
    <span
      className="mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        fontSize: 10,
        padding: "1px 5px",
        borderRadius: 3,
        color: "oklch(0.52 0.11 245)",
        border: "1px solid oklch(0.52 0.11 245 / 0.35)",
        background: "oklch(0.52 0.11 245 / 0.08)",
      }}
    >
      <Icon.Spark style={{ width: 10, height: 10 }} />
      {label}
    </span>
  );
}

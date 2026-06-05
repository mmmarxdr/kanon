import type { Requirement } from "@/lib/password-policy";

export interface PasswordRequirementsProps {
  requirements: Requirement[];
}

/**
 * Stateless requirements checklist.
 * Container is always mounted (aria-live region must exist before content changes).
 * max-length item is hidden when met — only shown when violated (paste guard UX).
 * Styling uses inline styles + CSS vars to match auth screen conventions.
 */
export function PasswordRequirements({ requirements }: PasswordRequirementsProps) {
  const visible = requirements.filter(
    (r) => !(r.id === "max-length" && r.met),
  );

  return (
    <div
      data-testid="password-requirements"
      id="password-requirements"
      aria-live="polite"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        fontSize: 12,
      }}
    >
      {visible.map((r) => (
        <div
          key={r.id}
          data-testid={`requirement-${r.id}`}
          data-met={String(r.met)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            color: r.met ? "var(--accent)" : "var(--ink-3)",
          }}
        >
          <span aria-hidden="true">{r.met ? "✓" : "✗"}</span>
          {r.label}
        </div>
      ))}
    </div>
  );
}

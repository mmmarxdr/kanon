import { useState } from "react";

interface Project {
  key: string;
  name: string;
}

interface ProjectPickerPopoverProps {
  projects: Project[];
  onSelect: (projectKey: string) => void;
  children: (open: () => void, disabled: boolean) => React.ReactNode;
  "data-testid"?: string;
}

/**
 * Render-prop popover for project selection.
 *
 * Behavior (REQ-INBOX-QUICK-003 + REQ-INBOX-QUICK-004, design §4.4):
 * - 0 projects → disabled=true, open() is a no-op, no popover mounted.
 * - 1 project  → open() short-circuits, calls onSelect(key) directly, no popover.
 * - 2+ projects → open() mounts a role="menu" popover with all projects listed;
 *                 selecting one calls onSelect(key) and closes the popover.
 */
export function ProjectPickerPopover({
  projects,
  onSelect,
  children,
  "data-testid": testId,
}: ProjectPickerPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const disabled = projects.length === 0;

  function open() {
    if (disabled) return;
    if (projects.length === 1) {
      onSelect(projects[0]!.key);
      return;
    }
    setIsOpen(true);
  }

  function handleSelect(key: string) {
    onSelect(key);
    setIsOpen(false);
  }

  return (
    <div style={{ position: "relative" }} data-testid={testId}>
      {children(open, disabled)}

      {isOpen && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            zIndex: 100,
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: 6,
            boxShadow: "0 8px 24px color-mix(in oklch, black 20%, transparent)",
            minWidth: 180,
            padding: "4px 0",
          }}
        >
          {projects.map((p) => (
            <button
              key={p.key}
              type="button"
              role="menuitem"
              onClick={() => handleSelect(p.key)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "8px 12px",
                fontSize: 12.5,
                color: "var(--ink)",
                cursor: "pointer",
                background: "transparent",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "var(--bg-3)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "transparent")
              }
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

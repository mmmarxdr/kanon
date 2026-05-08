import { useEffect, useRef, useState } from "react";

interface Project {
  key: string;
  name: string;
}

interface ProjectPickerPopoverProps {
  projects: Project[];
  onSelect: (projectKey: string) => void;
  /**
   * Render-prop signature. The third argument `isOpen` is additive — existing
   * callers that only accept two arguments remain valid at runtime. TypeScript
   * callers may accept the third arg to wire `aria-expanded` on the trigger.
   */
  children: (open: () => void, disabled: boolean, isOpen: boolean) => React.ReactNode;
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
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const disabled = projects.length === 0;

  function open() {
    if (disabled) return;
    if (projects.length === 1) {
      onSelect(projects[0]!.key);
      return;
    }
    setIsOpen(true);
  }

  function close() {
    setIsOpen(false);
    // Return focus to the trigger button after the popover unmounts
    queueMicrotask(() => {
      const trigger = containerRef.current?.querySelector<HTMLElement>(
        ":scope > button, :scope > [role='button'], :scope > [tabindex]"
      );
      trigger?.focus();
    });
  }

  function handleSelect(key: string) {
    onSelect(key);
    close();
  }

  // Focus the first menu item when the popover opens
  useEffect(() => {
    if (isOpen) {
      itemRefs.current = [];
      queueMicrotask(() => {
        itemRefs.current[0]?.focus();
      });
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current) return;
      if (containerRef.current.contains(event.target as Node)) return;
      close();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopImmediatePropagation();
        close();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  function handleMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const items = itemRefs.current.filter((el): el is HTMLButtonElement => el !== null);
    if (items.length === 0) return;
    const currentIndex = items.findIndex((el) => el === document.activeElement);

    switch (event.key) {
      case "ArrowDown": {
        event.preventDefault();
        const next = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
        items[next]?.focus();
        break;
      }
      case "ArrowUp": {
        event.preventDefault();
        const prev = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
        items[prev]?.focus();
        break;
      }
      case "Home": {
        event.preventDefault();
        items[0]?.focus();
        break;
      }
      case "End": {
        event.preventDefault();
        items[items.length - 1]?.focus();
        break;
      }
      case "Tab": {
        // Close menu and let focus advance naturally (WAI-ARIA menu pattern)
        close();
        break;
      }
    }
  }

  return (
    <div ref={containerRef} style={{ position: "relative" }} data-testid={testId}>
      {children(open, disabled, isOpen)}

      {isOpen && (
        <div
          role="menu"
          aria-label="Select project"
          onKeyDown={handleMenuKeyDown}
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
          {projects.map((p, index) => (
            <button
              key={p.key}
              type="button"
              role="menuitem"
              ref={(el) => { itemRefs.current[index] = el; }}
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

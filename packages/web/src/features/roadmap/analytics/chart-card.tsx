import type { ReactNode } from "react";

interface ChartCardProps {
  title: string;
  subtitle?: string;
  /** Optional right-aligned content in the header (legend, action). */
  headerRight?: ReactNode;
  isEmpty?: boolean;
  emptyMessage?: string;
  children: ReactNode;
}

/**
 * Card wrapper for analytics tiles. Border + bordered header row to match the
 * "ACard" pattern from the redesign — separation between title strip and body
 * makes scanning easier when there are many cards on screen.
 */
export function ChartCard({
  title,
  subtitle,
  headerRight,
  isEmpty = false,
  emptyMessage = "Not enough data to display this chart.",
  children,
}: ChartCardProps) {
  return (
    <div
      className="flex flex-col rounded-md"
      style={{
        border: "1px solid var(--color-line, var(--line))",
        background: "var(--color-panel, var(--panel))",
      }}
    >
      <div
        className="flex items-baseline justify-between gap-3 px-4 py-3"
        style={{
          borderBottom: "1px solid var(--color-line, var(--line))",
        }}
      >
        <div className="flex items-baseline gap-2 min-w-0">
          <h3 className="text-[13px] font-semibold tracking-[-0.01em] truncate">
            {title}
          </h3>
          {subtitle && (
            <span
              className="font-mono text-[11px] truncate"
              style={{ color: "var(--color-ink-4, var(--ink-4))" }}
            >
              {subtitle}
            </span>
          )}
        </div>
        {headerRight}
      </div>

      <div className="flex-1 p-4">
        {isEmpty ? (
          <div className="flex items-center justify-center h-40">
            <p
              className="text-sm"
              style={{ color: "var(--color-ink-3, var(--ink-3))" }}
            >
              {emptyMessage}
            </p>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

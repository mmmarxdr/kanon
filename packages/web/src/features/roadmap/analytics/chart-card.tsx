import type { ReactNode } from "react";

interface ChartCardProps {
  title: string;
  subtitle?: string;
  isEmpty?: boolean;
  emptyMessage?: string;
  children: ReactNode;
}

/**
 * Shared wrapper for analytics chart cards.
 * Pure presentational — each chart manages its own sizing via useContainerWidth.
 */
export function ChartCard({
  title,
  subtitle,
  isEmpty = false,
  emptyMessage = "Not enough data to display this chart.",
  children,
}: ChartCardProps) {
  return (
    <div className="bg-surface-container-lowest rounded-md p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-on-surface">{title}</h3>
        {subtitle && (
          <p className="text-xs text-on-surface/60 mt-0.5">{subtitle}</p>
        )}
      </div>

      {isEmpty ? (
        <div className="flex items-center justify-center h-40">
          <p className="text-sm text-on-surface/40">{emptyMessage}</p>
        </div>
      ) : (
        children
      )}
    </div>
  );
}

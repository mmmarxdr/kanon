interface ChartTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: Record<string, unknown> }>;
  labelKey?: string;
  valueKey?: string;
  valueSuffix?: string;
}

/**
 * Shared tooltip component for analytics charts.
 * Replaces duplicated CustomTooltip definitions across chart components.
 */
export function ChartTooltip({
  active,
  payload,
  labelKey = "label",
  valueKey = "count",
  valueSuffix = " item",
}: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  if (!entry) return null;
  const d = entry.payload;
  const label = String(d[labelKey] ?? "");
  const value = Number(d[valueKey] ?? 0);
  return (
    <div className="bg-surface-container-lowest rounded-md shadow-float p-2 text-xs text-on-surface">
      <p className="font-medium">{label}</p>
      <p className="text-on-surface/60">
        {value} {valueSuffix}{value !== 1 ? "s" : ""}
      </p>
    </div>
  );
}

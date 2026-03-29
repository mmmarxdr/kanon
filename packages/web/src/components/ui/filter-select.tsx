import type { ChangeEvent } from "react";

interface FilterSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: { label: string; value: string }[];
  allLabel?: string;
  className?: string;
  "data-testid"?: string;
}

export function FilterSelect({
  value,
  onChange,
  options,
  allLabel = "All",
  className,
  "data-testid": testId,
}: FilterSelectProps) {
  function handleChange(e: ChangeEvent<HTMLSelectElement>) {
    onChange(e.target.value);
  }

  return (
    <select
      value={value}
      onChange={handleChange}
      data-testid={testId}
      className={`h-8 rounded-md border-b-2 border-transparent bg-surface-container-high px-2 text-sm
        text-foreground
        focus:outline-none focus:ring-0 focus:border-b-primary
        transition-all duration-200 ease-out cursor-pointer ${className ?? ""}`}
    >
      <option value="">{allLabel}</option>
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

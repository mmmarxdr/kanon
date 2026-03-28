interface FilterChipGroupProps {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  options: { label: string; value: string }[];
  allLabel?: string;
  className?: string;
}

export function FilterChipGroup({
  value,
  onChange,
  options,
  allLabel = "All",
  className,
}: FilterChipGroupProps) {
  return (
    <div className={`flex items-center gap-1 ${className ?? ""}`}>
      {/* "All" chip */}
      <button
        type="button"
        onClick={() => onChange(undefined)}
        className={`px-2 py-1 text-xs uppercase tracking-wider rounded-md transition-all duration-200 ${
          value === undefined
            ? "bg-primary-fixed/20 text-primary font-semibold"
            : "text-muted-foreground hover:bg-foreground/5"
        }`}
      >
        {allLabel}
      </button>

      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(value === opt.value ? undefined : opt.value)}
          className={`px-2 py-1 text-xs uppercase tracking-wider rounded-md transition-all duration-200 ${
            value === opt.value
              ? "bg-primary-fixed/20 text-primary font-semibold"
              : "text-muted-foreground hover:bg-foreground/5"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

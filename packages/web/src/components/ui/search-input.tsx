import { useState, useEffect, useRef, type ChangeEvent } from "react";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  "data-testid"?: string;
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Search...",
  className,
  "data-testid": testId,
}: SearchInputProps) {
  const [localValue, setLocalValue] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync internal state when external value changes (e.g. clear filters)
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  // Debounce onChange calls by 300ms
  useEffect(() => {
    // Skip if already in sync
    if (localValue === value) return;

    timerRef.current = setTimeout(() => {
      onChange(localValue);
    }, 300);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [localValue]); // intentionally exclude onChange/value to avoid re-triggers

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    setLocalValue(e.target.value);
  }

  function handleClear() {
    setLocalValue("");
    onChange(""); // immediate, no debounce
    if (timerRef.current) clearTimeout(timerRef.current);
  }

  return (
    <div className={`relative ${className ?? ""}`}>
      {/* Search icon */}
      <svg
        className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>

      <input
        type="text"
        placeholder={placeholder}
        value={localValue}
        onChange={handleChange}
        data-testid={testId}
        className="h-8 w-64 rounded-md border-b-2 border-transparent bg-surface-container-high pl-8 pr-8 text-sm
          text-foreground placeholder:text-muted-foreground
          focus:outline-none focus:ring-0 focus:border-b-primary
          transition-all duration-200 ease-out"
      />

      {/* Clear X button */}
      {localValue && (
        <button
          type="button"
          onClick={handleClear}
          className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground hover:text-foreground cursor-pointer"
          aria-label="Clear search"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </div>
  );
}

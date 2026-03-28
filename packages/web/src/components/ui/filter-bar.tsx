import type { ReactNode } from "react";

interface FilterBarProps {
  children: ReactNode;
  className?: string;
}

export function FilterBar({ children, className }: FilterBarProps) {
  return (
    <div className={`flex items-center gap-2.5 flex-wrap ${className ?? ""}`}>
      {children}
    </div>
  );
}

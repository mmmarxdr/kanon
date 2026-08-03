import type { ReactNode } from "react";

/** Tailwind classes shared with profile and instance admin inputs (KAN-213). */
export const SETTINGS_INPUT_CLASS =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 transition-all duration-150 ease-out";

interface SettingsFieldProps {
  label: string;
  htmlFor: string;
  hint?: string;
  span?: "full" | "half";
  children: ReactNode;
}

export function SettingsField({
  label,
  htmlFor,
  hint,
  span = "half",
  children,
}: SettingsFieldProps) {
  const spanClass = span === "full" ? "md:col-span-2" : undefined;

  return (
    <div className={`space-y-2 ${spanClass ?? ""}`.trim()}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-card-foreground">
        {label}
        {hint && (
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">{hint}</span>
        )}
      </label>
      {children}
    </div>
  );
}

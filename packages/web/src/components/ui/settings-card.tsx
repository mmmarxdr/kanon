import type { ReactNode } from "react";

const BASE_CLASSES = "rounded-lg border border-border bg-card p-5 sm:p-6";

interface SettingsCardProps {
  children: ReactNode;
  className?: string;
  testId?: string;
  title?: string;
  actions?: ReactNode;
}

export function SettingsCard({ children, className, testId, title, actions }: SettingsCardProps) {
  const classes = className ? `${BASE_CLASSES} ${className}` : BASE_CLASSES;

  return (
    <section className={classes} data-testid={testId}>
      {(title || actions) && (
        <div className="flex items-center justify-between mb-4">
          {title ? (
            <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          ) : (
            <span />
          )}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

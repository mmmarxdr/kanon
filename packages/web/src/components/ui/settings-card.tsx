import type { ReactNode } from "react";

const BASE_CLASSES = "rounded-lg border border-border bg-card p-5 sm:p-6";

interface SettingsCardProps {
  children: ReactNode;
  className?: string;
  testId?: string;
  title?: string;
  description?: string;
  actions?: ReactNode;
  insetList?: boolean;
}

export function SettingsCard({
  children,
  className,
  testId,
  title,
  description,
  actions,
  insetList,
}: SettingsCardProps) {
  const classes = className ? `${BASE_CLASSES} ${className}` : BASE_CLASSES;
  const showHeader = title || description || actions;

  return (
    <section className={classes} data-testid={testId}>
      {showHeader && (
        <div className="flex items-start justify-between gap-4 mb-4">
          {(title || description) ? (
            <div className="min-w-0">
              {title && (
                <h2 className="text-lg font-semibold text-foreground">{title}</h2>
              )}
              {description && (
                <p className="mt-1 text-sm text-muted-foreground">{description}</p>
              )}
            </div>
          ) : (
            <span />
          )}
          {actions}
        </div>
      )}
      {insetList ? (
        // Bleed the inset background to the card edges, but keep content padded
        // so it stays aligned with the header (KAN-213 follow-up).
        <div className="-mx-5 sm:-mx-6 px-5 sm:px-6 bg-secondary/20">{children}</div>
      ) : (
        children
      )}
    </section>
  );
}

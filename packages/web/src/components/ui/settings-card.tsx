import type { ReactNode } from "react";

const BASE_CLASSES = "rounded-lg border border-border bg-card p-5 sm:p-6";

interface SettingsCardProps {
  children: ReactNode;
  className?: string;
  testId?: string;
}

export function SettingsCard({ children, className, testId }: SettingsCardProps) {
  const classes = className ? `${BASE_CLASSES} ${className}` : BASE_CLASSES;

  return (
    <section className={classes} data-testid={testId}>
      {children}
    </section>
  );
}

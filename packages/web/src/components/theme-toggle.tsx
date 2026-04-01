import { useThemeStore, type ThemePreference } from "@/stores/theme-store";
import { useI18n } from "@/hooks/use-i18n";

const OPTIONS: ThemePreference[] = ["light", "dark", "system"];

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { t } = useI18n();
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);

  const labelFor = (value: ThemePreference) => {
    if (value === "light") return t("theme.light");
    if (value === "dark") return t("theme.dark");
    return t("theme.system");
  };

  return (
    <div
      className={`inline-flex rounded-md border border-border bg-muted p-1 ${className}`}
      role="radiogroup"
      aria-label={t("theme.ariaLabel")}
    >
      {OPTIONS.map((option) => {
        const selected = preference === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setPreference(option)}
            className={`rounded px-2.5 py-1.5 text-xs transition-colors ${
              selected
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {labelFor(option)}
          </button>
        );
      })}
    </div>
  );
}

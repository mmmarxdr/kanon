import { useI18n } from "@/hooks/use-i18n";
import type { AppLocale } from "@/stores/locale-store";

const OPTIONS: AppLocale[] = ["en", "es"];

export function LocaleToggle({ className = "" }: { className?: string }) {
  const { t, locale, setLocale } = useI18n();

  return (
    <div
      className={`inline-flex rounded-md border border-border bg-muted p-1 ${className}`}
      role="radiogroup"
      aria-label={t("locale.ariaLabel")}
    >
      {OPTIONS.map((value) => {
        const selected = locale === value;
        const label = value === "en" ? t("locale.en") : t("locale.es");
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setLocale(value)}
            className={`rounded px-2.5 py-1.5 text-xs transition-colors ${
              selected
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
